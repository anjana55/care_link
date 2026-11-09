import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';
import {
  CORE_DOCUMENTS,
  TODO_EXPIRY_DAYS,
  addDays,
  colomboToUtc,
  colomboToday,
  formatLkr,
  toCents,
  toColombo,
  type TodoItem,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, caregiverDocuments, invoices, patients, caregivers } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CarePlansService } from '../care-plans/care-plans.service';
import { ReviewsService } from '../reviews/reviews.service';
import { NotificationsService } from './notifications.service';

/** "Tick off today's care" shows from this hour (Colombo), so a morning visit isn't nagged about before the day is done. */
export const CARE_TODO_FROM_HOUR = 18;
/** The list stops here: the bell is a reminder, not a report. */
const MAX_TODOS = 20;

/** Urgent first, then soonest due, then as found. */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(b.t.urgent) - Number(a.t.urgent) || (a.t.dueOn ?? '9999').localeCompare(b.t.dueOn ?? '9999') || a.i - b.i)
    .map((x) => x.t);
}

/** Days from `today` to `date` (both YYYY-MM-DD). */
export const daysBetween = (today: string, date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * The To do list: what is still waiting on a client or caregiver, worked out
 * from the data on every call. Nothing is stored, so an item is gone as soon
 * as the thing is done - no one has to clear it.
 *
 * Each kind is one small query for one person. A kind that fails is left
 * out rather than failing the bell.
 */
@Injectable()
export class TodosService implements OnModuleInit {
  private readonly logger = new Logger(TodosService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly carePlans: CarePlansService,
    private readonly reviews: ReviewsService,
    private readonly notices: NotificationsService,
  ) {}

  onModuleInit() {
    // The push badge counts to-dos too; NotificationsService can't depend on this module, so it is handed the counter.
    this.notices.setTodoCounter(async (userId) => (await this.forUserId(userId)).length);
  }

  async forUser(user: Pick<AuthenticatedUser, 'userId' | 'role' | 'patientId' | 'caregiverId' | 'email'>, now = new Date()): Promise<TodoItem[]> {
    if (user.role === 'PATIENT_GUARDIAN' && user.patientId) return this.forClient(user as AuthenticatedUser, user.patientId, now);
    if (user.role === 'CAREGIVER' && user.caregiverId) return this.forCaregiver(user.caregiverId, now);
    return [];
  }

  /** The same list for someone who isn't making the request (the push badge, the reminder sweep). */
  async forUserId(userId: string, now = new Date()): Promise<TodoItem[]> {
    const [p] = await this.db.select({ id: patients.id }).from(patients).where(eq(patients.userId, userId)).limit(1);
    if (p) return this.forClient({ userId, role: 'PATIENT_GUARDIAN', patientId: p.id, email: null }, p.id, now);
    const [c] = await this.db.select({ id: caregivers.id }).from(caregivers).where(and(eq(caregivers.userId, userId), isNull(caregivers.deletedAt))).limit(1);
    if (c) return this.forCaregiver(c.id, now);
    return [];
  }

  private async safe(label: string, f: () => Promise<TodoItem[]>): Promise<TodoItem[]> {
    try {
      return await f();
    } catch (err) {
      this.logger.warn(`To do (${label}) skipped: ${(err as Error).message}`);
      return [];
    }
  }

  // --- clients ----------------------------------------------------------------------

  async forClient(user: AuthenticatedUser, patientId: string, now = new Date()): Promise<TodoItem[]> {
    const parts = await Promise.all([
      this.safe('invoices', () => this.invoicesToPay(patientId, now)),
      this.safe('ratings', () => this.caregiversToRate(user)),
      this.safe('care', () => this.careToTick(patientId, now)),
    ]);
    return sortTodos(parts.flat()).slice(0, MAX_TODOS);
  }

  async invoicesToPay(patientId: string, now = new Date()): Promise<TodoItem[]> {
    const today = colomboToday(now);
    const rows = await this.db
      .select({ id: invoices.id, number: invoices.number, total: invoices.total, amountPaid: invoices.amountPaid, dueDate: invoices.dueDate })
      .from(invoices)
      .where(and(eq(invoices.patientId, patientId), eq(invoices.status, 'ISSUED')))
      .orderBy(asc(invoices.dueDate))
      .limit(MAX_TODOS);
    return rows
      .map((r) => ({ ...r, owed: toCents(r.total) - toCents(r.amountPaid) }))
      .filter((r) => r.owed > 0)
      .map((r) => {
        const overdue = Boolean(r.dueDate && r.dueDate < today);
        return {
          key: `invoice:${r.id}`,
          kind: 'PAY_INVOICE' as const,
          path: `/invoices/${r.id}`,
          urgent: overdue,
          dueOn: r.dueDate,
          params: { number: r.number ?? '', amount: formatLkr(r.owed / 100), overdue: overdue ? 1 : 0 },
        };
      });
  }

  async caregiversToRate(user: AuthenticatedUser): Promise<TodoItem[]> {
    const pending = await this.reviews.pending(user);
    return pending
      .filter((p) => p.canReview)
      .map((p) => ({
        key: `review:${p.bookingId}:${p.caregiverPublicId}`,
        kind: 'RATE_CAREGIVER' as const,
        path: `/bookings/${p.bookingId}/rate/${p.caregiverPublicId}`,
        urgent: false,
        dueOn: p.reviewUntil.slice(0, 10),
        params: { reference: p.bookingReference, cover: p.isCover ? 1 : 0 },
      }));
  }

  async careToTick(patientId: string, now = new Date()): Promise<TodoItem[]> {
    if (Number(toColombo(now).time.slice(0, 2)) < CARE_TODO_FROM_HOUR) return [];
    const count = await this.carePlans.openCountForPatient(patientId, now);
    if (!count) return [];
    const today = colomboToday(now);
    return [{ key: `care:${today}`, kind: 'TICK_OFF_CARE', path: '/care', urgent: true, dueOn: today, params: { count } }];
  }

  // --- caregivers -------------------------------------------------------------------

  async forCaregiver(caregiverId: string, now = new Date()): Promise<TodoItem[]> {
    const parts = await Promise.all([this.safe('documents', () => this.documents(caregiverId, now)), this.safe('shifts', () => this.shiftsToday(caregiverId, now))]);
    return sortTodos(parts.flat()).slice(0, MAX_TODOS);
  }

  /**
   * The core documents staff need (identity, police clearance, GN
   * certificate): one missing, or the latest upload of it rejected; and any
   * dated document running out within TODO_EXPIRY_DAYS, or already out.
   */
  async documents(caregiverId: string, now = new Date()): Promise<TodoItem[]> {
    const today = colomboToday(now);
    const docs = await this.db
      .select({
        id: caregiverDocuments.id,
        type: caregiverDocuments.documentType,
        status: caregiverDocuments.verificationStatus,
        expiresOn: caregiverDocuments.expiresOn,
        createdAt: caregiverDocuments.createdAt,
      })
      .from(caregiverDocuments)
      .where(eq(caregiverDocuments.caregiverId, caregiverId));
    const out: TodoItem[] = [];
    for (const core of CORE_DOCUMENTS) {
      const mine = docs.filter((d) => (core.anyOf as readonly string[]).includes(d.type));
      const usable = mine.filter((d) => d.status !== 'REJECTED');
      if (usable.length) continue;
      const rejected = mine.length > 0;
      out.push({
        key: `document:${core.label}`,
        kind: rejected ? 'DOCUMENT_REJECTED' : 'UPLOAD_DOCUMENT',
        path: '/documents',
        urgent: rejected,
        dueOn: null,
        params: { document: core.label },
      });
    }
    // The newest upload of each type is the one that counts for expiry: a renewed document replaces the old one.
    const newest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) {
      if (d.status === 'REJECTED' || !d.expiresOn) continue;
      const prev = newest.get(d.type);
      if (!prev || (prev.expiresOn ?? '') < d.expiresOn) newest.set(d.type, d);
    }
    for (const d of newest.values()) {
      const daysLeft = daysBetween(today, d.expiresOn!);
      if (daysLeft > TODO_EXPIRY_DAYS) continue;
      out.push({
        key: `expiry:${d.id}`,
        kind: 'DOCUMENT_EXPIRING',
        path: '/documents',
        urgent: daysLeft <= 7,
        dueOn: d.expiresOn,
        params: { document: d.type, daysLeft },
      });
    }
    return out;
  }

  async shiftsToday(caregiverId: string, now = new Date()): Promise<TodoItem[]> {
    const today = colomboToday(now);
    const rows = await this.db
      .select({ id: bookingShifts.id, startsAt: bookingShifts.startsAt, reference: bookings.reference })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .where(
        and(
          eq(bookingShifts.caregiverId, caregiverId),
          eq(bookingShifts.status, 'SCHEDULED'),
          eq(bookings.status, 'CONFIRMED'),
          gte(bookingShifts.startsAt, now),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(today, 1), '00:00')),
        ),
      )
      .orderBy(asc(bookingShifts.startsAt))
      .limit(5);
    return rows.map((r) => ({
      key: `shift:${r.id}`,
      kind: 'SHIFT_TODAY' as const,
      path: '/shifts',
      urgent: true,
      dueOn: today,
      params: { time: toColombo(new Date(r.startsAt)).time, reference: r.reference },
    }));
  }
}

