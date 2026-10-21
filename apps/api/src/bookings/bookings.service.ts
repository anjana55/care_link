import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  colomboLocalToIso,
  colomboToday,
  computeTotals,
  formatLkr,
  colomboToUtc,
  addDays,
  generateShifts,
  isValidDate,
  isoToColomboLocal,
  shiftHours,
  MAX_GENERATED_SHIFTS,
  MAX_SHIFT_HOURS,
  type CaregiverShift,
  type ClientBooking,
  type IsoWeekday,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  bookings,
  bookingShifts,
  bookingEvents,
  bookingIssueReports,
  careRequests,
  careRequestEvents,
  caregivers,
  patients,
  users,
  cities,
  districts,
  invoiceLines,
  invoices,
  payoutLines,
  payoutStatements,
  BLOCKING_SHIFT_STATUSES,
  type BookingEventType,
  type BookingStatus,
  type ShiftRateType,
  type ShiftStatus,
} from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PublicSearchService } from '../public-search/public-search.service';
import { BookingNotifier } from './booking-notifier.service';
import { buildLines } from '../billing/line-builder';
import { planRoster } from './roster-plan';
import {
  AddShiftDto,
  BookingPatternDto,
  BookingQueryDto,
  CreateBookingDto,
  UpdateBookingDto,
  UpdateShiftDto,
} from './dto/booking.dto';

/** Longest single booking pattern, so one form submission can't generate years of rows. */
export const MAX_BOOKING_DAYS = 366;

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function bookingReference(): string {
  let out = 'BK-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

/**
 * Writes that check for overlapping shifts run READ COMMITTED: once
 * lockCaregivers has waited out a concurrent write for the same caregiver,
 * the overlap query must see what that write committed, not a snapshot taken
 * before the wait (REPEATABLE READ's default) - otherwise two confirms racing
 * for one slot would both pass.
 */
const CHECKED = { isolationLevel: 'read committed' as const };

const isDuplicate = (err: unknown, index?: string) => {
  const e = err as { code?: string; sqlMessage?: string; cause?: { code?: string; sqlMessage?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY' && (!index || (e.sqlMessage ?? e.cause?.sqlMessage ?? '').includes(index));
};

/** Moves staff may make on one shift's status. DRAFT only ever leaves through confirming the booking. */
const SHIFT_STATUS_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  DRAFT: [],
  SCHEDULED: ['COMPLETED', 'MISSED', 'CANCELLED'],
  COMPLETED: ['SCHEDULED', 'MISSED'],
  MISSED: ['SCHEDULED', 'COMPLETED'],
  CANCELLED: ['SCHEDULED'],
};

/** Statuses that mean a shift happened, or is still meant to - the ones the estimate counts. */
const COUNTED: readonly ShiftStatus[] = ['DRAFT', 'SCHEDULED', 'COMPLETED'];

type Tx = Database;
interface ShiftRow {
  id: string;
  bookingId: string;
  caregiverId: string;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
}

export interface ShiftConflict {
  shiftId: string;
  /** The other shift it overlaps. */
  withShiftId: string;
  withBookingId: string;
  withBookingReference: string;
  /** BLOCKING: the other shift is confirmed - this one cannot be confirmed. DRAFT: both are still drafts. */
  kind: 'BLOCKING' | 'DRAFT';
}

/**
 * Bookings and their shifts: staff create a booking from a pattern, the
 * pattern becomes dated DRAFT shifts, staff adjust any of them, then confirm -
 * which schedules the shifts and tells the client and caregiver.
 *
 * The one rule that must never break: a caregiver cannot hold two shifts that
 * overlap in time. It is checked on every write that can create a held shift
 * (confirm, add, edit, cover, extend, reinstate), inside a transaction that
 * first locks the caregivers involved, so two staff confirming two bookings for
 * the same person at the same moment cannot both succeed.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly publicSearch: PublicSearchService,
    private readonly notifier: BookingNotifier,
  ) {}

  // --- pattern ---------------------------------------------------------------

  private validatePattern(p: BookingPatternDto) {
    if (!isValidDate(p.startDate) || !isValidDate(p.endDate)) throw new BadRequestException('Enter valid start and end dates');
    if (p.endDate < p.startDate) throw new BadRequestException('The end date must be on or after the start date');
    const days = (Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_BOOKING_DAYS) throw new BadRequestException('A booking can cover at most a year - extend it later if needed');
    const shifts = generateShifts({ ...p, daysOfWeek: p.daysOfWeek as IsoWeekday[] });
    if (!shifts.length) throw new BadRequestException('The chosen days produce no shifts between those dates');
    if (shifts.length > MAX_GENERATED_SHIFTS) throw new BadRequestException('A booking can cover at most a year - extend it later if needed');
    return shifts;
  }

  private static daysString(days: number[]) {
    return [...new Set(days)].sort((a, b) => a - b).join(',');
  }

  // --- reading ---------------------------------------------------------------

  async findAll(query: BookingQueryDto) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(bookings.status, query.status));
    if (query.patientId) conditions.push(eq(bookings.patientId, query.patientId));
    if (query.caregiverId) conditions.push(eq(bookings.caregiverId, query.caregiverId));
    if (query.careRequestId) conditions.push(eq(bookings.careRequestId, query.careRequestId));
    // Bookings a client or caregiver has reported a problem on that staff have not answered yet.
    if (query.hasOpenIssues) {
      conditions.push(sql`EXISTS (SELECT 1 FROM ${bookingIssueReports} WHERE ${bookingIssueReports.bookingId} = ${bookings.id} AND ${bookingIssueReports.status} = 'OPEN')`);
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(
        or(
          like(bookings.reference, term),
          like(patients.fullName, term),
          like(patients.recipientName, term),
          like(caregivers.fullName, term),
          like(caregivers.registrationNumber, term),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(bookings)
      .innerJoin(patients, eq(bookings.patientId, patients.id))
      .innerJoin(caregivers, eq(bookings.caregiverId, caregivers.id))
      .where(where);

    const rows = await this.db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        scheduleType: bookings.scheduleType,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        shiftStartTime: bookings.shiftStartTime,
        shiftEndTime: bookings.shiftEndTime,
        daysOfWeek: bookings.daysOfWeek,
        clientId: patients.id,
        clientName: patients.fullName,
        recipientName: patients.recipientName,
        caregiverId: caregivers.id,
        caregiverName: caregivers.fullName,
        caregiverRegistrationNumber: caregivers.registrationNumber,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .innerJoin(patients, eq(bookings.patientId, patients.id))
      .innerJoin(caregivers, eq(bookings.caregiverId, caregivers.id))
      .where(where)
      .orderBy(sql`FIELD(${bookings.status}, 'DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED')`, asc(bookings.startDate))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    // The next shift still to come, per booking, in one query.
    const ids = rows.map((r) => r.id);
    const next = ids.length
      ? await this.db
          .select({ bookingId: bookingShifts.bookingId, nextAt: sql<Date>`MIN(${bookingShifts.startsAt})` })
          .from(bookingShifts)
          .where(and(inArray(bookingShifts.bookingId, ids), inArray(bookingShifts.status, ['DRAFT', 'SCHEDULED']), gt(bookingShifts.startsAt, new Date())))
          .groupBy(bookingShifts.bookingId)
      : [];
    const nextBy = new Map(next.map((n) => [n.bookingId, n.nextAt]));
    const issues = ids.length
      ? await this.db
          .select({ bookingId: bookingIssueReports.bookingId, n: count() })
          .from(bookingIssueReports)
          .where(and(inArray(bookingIssueReports.bookingId, ids), eq(bookingIssueReports.status, 'OPEN')))
          .groupBy(bookingIssueReports.bookingId)
      : [];
    const issuesBy = new Map(issues.map((i) => [i.bookingId, i.n]));

    return {
      items: rows.map((r) => ({ ...r, nextShiftAt: nextBy.get(r.id) ? new Date(nextBy.get(r.id)!).toISOString() : null, openIssues: issuesBy.get(r.id) ?? 0 })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Counts for the sidebar and dashboard: bookings by status, and confirmed shifts starting today (Colombo). */
  async summary() {
    const rows = await this.db.select({ status: bookings.status, n: count() }).from(bookings).groupBy(bookings.status);
    const byStatus: Record<BookingStatus, number> = { DRAFT: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const r of rows) byStatus[r.status] = r.n;
    const today = colomboToday();
    const [{ shiftsToday }] = await this.db
      .select({ shiftsToday: count() })
      .from(bookingShifts)
      .where(
        and(
          eq(bookingShifts.status, 'SCHEDULED'),
          gte(bookingShifts.startsAt, colomboToUtc(today, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(today, 1), '00:00')),
        ),
      );
    const [{ openIssues }] = await this.db.select({ openIssues: count() }).from(bookingIssueReports).where(eq(bookingIssueReports.status, 'OPEN'));
    return { byStatus, shiftsToday, openIssues };
  }

  private async bookingOrThrow(id: string, db: Tx = this.db) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!row) throw new NotFoundException('Booking not found');
    return row;
  }

  async findOne(id: string) {
    const booking = await this.bookingOrThrow(id);
    const [shifts, events, [patient], request] = await Promise.all([
      this.db.select().from(bookingShifts).where(eq(bookingShifts.bookingId, id)).orderBy(asc(bookingShifts.startsAt)),
      this.db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, id)).orderBy(asc(bookingEvents.createdAt)),
      this.db.select().from(patients).where(eq(patients.id, booking.patientId)).limit(1),
      booking.careRequestId
        ? this.db
            .select({ id: careRequests.id, reference: careRequests.reference, status: careRequests.status })
            .from(careRequests)
            .where(eq(careRequests.id, booking.careRequestId))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const caregiverIds = [...new Set([booking.caregiverId, ...shifts.map((s) => s.caregiverId)])];
    const cgRows = await this.db
      .select({
        id: caregivers.id,
        fullName: caregivers.fullName,
        registrationNumber: caregivers.registrationNumber,
        status: caregivers.status,
        primaryPhone: caregivers.primaryPhone,
        deletedAt: caregivers.deletedAt,
      })
      .from(caregivers)
      .where(inArray(caregivers.id, caregiverIds));
    const cg = new Map(cgRows.map((c) => [c.id, c]));
    const conflicts = await this.conflictsFor(shifts.filter((s) => s.status !== 'CANCELLED' && s.status !== 'MISSED'));
    const byShift = new Map<string, ShiftConflict[]>();
    for (const c of conflicts) byShift.set(c.shiftId, [...(byShift.get(c.shiftId) ?? []), c]);

    const billing = await this.billingRefs(shifts.map((s) => s.id));

    const actorIds = [booking.createdByUserId, booking.confirmedByUserId, ...events.map((e) => e.actorUserId), ...shifts.map((s) => s.updatedByUserId)];
    const names = await this.userNames(actorIds);
    const [place] = patient?.cityId
      ? await this.db
          .select({ city: cities.nameEn, district: districts.nameEn })
          .from(cities)
          .innerJoin(districts, eq(cities.districtId, districts.id))
          .where(eq(cities.id, patient.cityId))
          .limit(1)
      : [];

    const caregiverRef = (cid: string) => {
      const c = cg.get(cid);
      return c ? { id: c.id, fullName: c.fullName, registrationNumber: c.registrationNumber, status: c.status, deleted: Boolean(c.deletedAt) } : null;
    };
    const booked = cg.get(booking.caregiverId);

    return {
      ...booking,
      daysOfWeek: booking.daysOfWeek.split(',').map(Number),
      createdBy: booking.createdByUserId ? (names.get(booking.createdByUserId) ?? null) : null,
      confirmedBy: booking.confirmedByUserId ? (names.get(booking.confirmedByUserId) ?? null) : null,
      careRequest: request[0] ?? null,
      client: patient
        ? {
            id: patient.id,
            fullName: patient.fullName,
            phone: patient.phone,
            recipientName: patient.recipientName,
            city: place?.city ?? patient.city,
            district: place?.district ?? patient.district,
            careAddress: patient.careAddress,
          }
        : null,
      caregiver: booked
        ? { ...caregiverRef(booking.caregiverId)!, primaryPhone: booked.primaryPhone }
        : null,
      shifts: shifts.map((s) => ({
        id: s.id,
        startsAt: new Date(s.startsAt).toISOString(),
        endsAt: new Date(s.endsAt).toISOString(),
        hours: shiftHours(s.startsAt, s.endsAt),
        status: s.status,
        note: s.note,
        // This shift's own rates (null = the booking's), and whether the
        // monthly rule means it cannot have one on that side.
        rateType: s.rateType,
        rateAmount: s.rateAmount,
        payRateType: s.payRateType,
        payRateAmount: s.payRateAmount,
        clientRateLocked: booking.rateType === 'MONTHLY',
        payRateLocked: booking.payRateType === 'MONTHLY' && s.caregiverId === booking.caregiverId,
        // The live invoice / payout statement the shift is already on, if any.
        invoice: billing.invoices.get(s.id) ?? null,
        payout: billing.payouts.get(s.id) ?? null,
        caregiver: caregiverRef(s.caregiverId),
        isCover: s.caregiverId !== booking.caregiverId,
        conflicts: byShift.get(s.id) ?? [],
        allowedStatuses: SHIFT_STATUS_TRANSITIONS[s.status],
        updatedBy: s.updatedByUserId ? (names.get(s.updatedByUserId) ?? null) : null,
      })),
      estimate: BookingsService.estimate('CLIENT', booking, shifts),
      // What the caregiver side comes to over the same shifts, and the difference.
      payEstimate: BookingsService.estimate('PAY', { ...booking, rateType: booking.payRateType, rateAmount: booking.payRateAmount }, shifts),
      blockingConflicts: conflicts.filter((c) => c.kind === 'BLOCKING').length,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        note: e.note,
        createdAt: e.createdAt,
        actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
      })),
    };
  }

  /**
   * What one side of the booking comes to over the shifts that are happening
   * or happened (drafts, scheduled, completed): the client side at the agreed
   * rate, or the caregiver side at the pay rate. Priced by the same line
   * builder invoices and payouts use - shifts with their own rate at that
   * rate, a monthly rate by the calendar month - so the estimate and the
   * eventual bill follow one rule.
   */
  static estimate(
    side: 'CLIENT' | 'PAY',
    b: { id: string; reference: string; caregiverId: string; rateType: RateTypeValue | null; rateAmount: string | null; startDate: string; endDate: string },
    shifts: {
      id: string;
      caregiverId: string;
      startsAt: Date;
      endsAt: Date;
      status: ShiftStatus;
      rateType: ShiftRateType | null;
      rateAmount: string | null;
      payRateType: ShiftRateType | null;
      payRateAmount: string | null;
    }[],
  ) {
    const live = shifts.filter((s) => COUNTED.includes(s.status));
    const hours = Math.round(live.reduce((sum, s) => sum + shiftHours(s.startsAt, s.endsAt), 0) * 100) / 100;
    const own = live.filter((s) => (side === 'CLIENT' ? s.rateType : s.payRateType)).length;
    const base = { shifts: live.length, hours, rateType: b.rateType, rateAmount: b.rateAmount, ownRateShifts: own, unpriced: 0, total: null as string | null, units: null as number | null };
    if (!live.length) return base;
    const { lines, unpriced } = buildLines({
      mode: side === 'CLIENT' ? 'INVOICE' : 'PAYOUT',
      language: 'en',
      from: b.startDate < toColomboDate(live[0].startsAt) ? b.startDate : toColomboDate(live[0].startsAt),
      to: b.endDate > toColomboDate(live.at(-1)!.startsAt) ? b.endDate : toColomboDate(live.at(-1)!.startsAt),
      statuses: COUNTED,
      bookings: [b],
      shifts: [...live]
        .sort((x, y) => new Date(x.startsAt).getTime() - new Date(y.startsAt).getTime())
        .map((s) => ({
          id: s.id,
          bookingId: b.id,
          caregiverId: s.caregiverId,
          startsAt: new Date(s.startsAt),
          endsAt: new Date(s.endsAt),
          status: s.status,
          rateType: side === 'CLIENT' ? s.rateType : s.payRateType,
          rateAmount: side === 'CLIENT' ? s.rateAmount : s.payRateAmount,
        })),
      billedShiftIds: new Set(),
      billedPeriods: [],
    });
    // Nothing priced at all: no estimate, as before any rate is recorded.
    if (!lines.length || unpriced === lines.length) return { ...base, unpriced };
    const units = new Set(lines.map((l) => l.unit)).size === 1 ? Math.round(lines.reduce((sum, l) => sum + Number(l.quantity), 0) * 100) / 100 : null;
    return { ...base, unpriced, units, total: computeTotals({ lines: lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })) }).total };
  }

  // billingRefs, assertNoOverlap, lockCaregivers, event, liveCaregiver,
  // parseRange and resolveShiftRates are also used by booking corrections
  // (corrections/corrections.service.ts), so a corrected shift follows exactly
  // the same rules as an edited one.

  /** For each shift, the live (not void) invoice and payout statement it is on. */
  async billingRefs(shiftIds: string[], db: Tx = this.db) {
    const out = {
      invoices: new Map<string, { id: string; number: string | null; status: string }>(),
      payouts: new Map<string, { id: string; reference: string; status: string }>(),
    };
    if (!shiftIds.length) return out;
    const [inv, pay] = await Promise.all([
      db
        .select({ shiftId: invoiceLines.shiftId, id: invoices.id, number: invoices.number, status: invoices.status })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(inArray(invoiceLines.shiftId, shiftIds), ne(invoices.status, 'VOID'))),
      db
        .select({ shiftId: payoutLines.shiftId, id: payoutStatements.id, reference: payoutStatements.reference, status: payoutStatements.status })
        .from(payoutLines)
        .innerJoin(payoutStatements, eq(payoutLines.statementId, payoutStatements.id))
        .where(and(inArray(payoutLines.shiftId, shiftIds), ne(payoutStatements.status, 'VOID'))),
    ]);
    for (const r of inv) if (r.shiftId) out.invoices.set(r.shiftId, { id: r.id, number: r.number, status: r.status });
    for (const r of pay) if (r.shiftId) out.payouts.set(r.shiftId, { id: r.id, reference: r.reference, status: r.status });
    return out;
  }

  /**
   * Refuses an edit that would cancel shifts already billed, or move shifts
   * already on a caregiver's pay statement to someone else - the bill would
   * no longer match the roster. Staff void or revise the document first, or
   * start the change on a later day.
   */
  private async assertNotBilled(db: Tx, dropIds: string[], reassignIds: string[]) {
    const refs = await this.billingRefs([...new Set([...dropIds, ...reassignIds])], db);
    const docs = new Set<string>();
    for (const id of dropIds) {
      const i = refs.invoices.get(id);
      if (i) docs.add(i.number ? `invoice ${i.number}` : 'a draft invoice');
    }
    for (const id of [...dropIds, ...reassignIds]) {
      const p = refs.payouts.get(id);
      if (p) docs.add(`pay statement ${p.reference}`);
    }
    if (docs.size) {
      throw new ConflictException(
        `Some of the shifts this would change are already on ${[...docs].join(', ')} - void or revise it first, or start the change on a later day`,
      );
    }
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const map = new Map<string, { id: string; fullName: string }>();
    if (!unique.length) return map;
    for (const r of await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique))) map.set(r.id, r);
    return map;
  }

  /**
   * Overlaps between the given shifts and every other shift held by the same
   * caregivers - in other bookings and in this one. Two intervals overlap when
   * each starts before the other ends; back-to-back shifts do not.
   */
  private async conflictsFor(shifts: ShiftRow[], db: Tx = this.db): Promise<ShiftConflict[]> {
    if (!shifts.length) return [];
    const caregiverIds = [...new Set(shifts.map((s) => s.caregiverId))];
    const from = new Date(Math.min(...shifts.map((s) => new Date(s.startsAt).getTime())));
    const to = new Date(Math.max(...shifts.map((s) => new Date(s.endsAt).getTime())));
    const others = await db
      .select({
        id: bookingShifts.id,
        bookingId: bookingShifts.bookingId,
        caregiverId: bookingShifts.caregiverId,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        reference: bookings.reference,
        bookingStatus: bookings.status,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .where(
        and(
          inArray(bookingShifts.caregiverId, caregiverIds),
          inArray(bookingShifts.status, ['DRAFT', 'SCHEDULED', 'COMPLETED']),
          lt(bookingShifts.startsAt, to),
          gt(bookingShifts.endsAt, from),
          ne(bookings.status, 'CANCELLED'),
        ),
      );

    const out: ShiftConflict[] = [];
    for (const s of shifts) {
      const sStart = new Date(s.startsAt).getTime();
      const sEnd = new Date(s.endsAt).getTime();
      for (const o of others) {
        if (o.id === s.id || o.caregiverId !== s.caregiverId) continue;
        if (new Date(o.startsAt).getTime() < sEnd && new Date(o.endsAt).getTime() > sStart) {
          out.push({
            shiftId: s.id,
            withShiftId: o.id,
            withBookingId: o.bookingId,
            withBookingReference: o.reference,
            kind: BLOCKING_SHIFT_STATUSES.includes(o.status) ? 'BLOCKING' : 'DRAFT',
          });
        }
      }
    }
    return out;
  }

  /**
   * Refuses a write that would leave any of `shifts` overlapping a held shift
   * (or each other). Call inside the write's transaction, after lockCaregivers.
   */
  async assertNoOverlap(db: Tx, shifts: ShiftRow[], ignoreDrafts = true) {
    // Within the set itself (e.g. a cover and the booked caregiver both on one slot).
    const sorted = [...shifts].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length && new Date(sorted[j].startsAt) < new Date(sorted[i].endsAt); j++) {
        if (sorted[j].caregiverId === sorted[i].caregiverId) {
          throw new ConflictException('Two of these shifts overlap for the same caregiver - change the times or the caregiver first');
        }
      }
    }
    const ids = new Set(shifts.map((s) => s.id));
    const clashes = (await this.conflictsFor(shifts, db)).filter((c) => !ids.has(c.withShiftId) && (!ignoreDrafts || c.kind === 'BLOCKING'));
    if (clashes.length) {
      const refs = [...new Set(clashes.map((c) => c.withBookingReference))].join(', ');
      throw new ConflictException(`This overlaps shifts the caregiver already has (${refs}) - change the times or choose another caregiver`);
    }
  }

  /** Serialises writes per caregiver: a second transaction for the same person waits here. */
  async lockCaregivers(db: Tx, caregiverIds: string[]) {
    const ids = [...new Set(caregiverIds)].sort();
    if (ids.length) await db.execute(sql`SELECT id FROM caregivers WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) FOR UPDATE`);
  }

  async event(db: Tx, bookingId: string, type: BookingEventType, actor: AuthenticatedUser | null, note?: string | null) {
    await db.insert(bookingEvents).values({ id: uuid(), bookingId, type, note: note ?? null, actorUserId: actor?.userId ?? null });
  }

  async liveCaregiver(caregiverId: string, db: Tx = this.db) {
    const [row] = await db
      .select({ id: caregivers.id })
      .from(caregivers)
      .where(and(eq(caregivers.id, caregiverId), isNull(caregivers.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Caregiver not found');
    return row.id;
  }

  // --- creating and shaping ---------------------------------------------------

  async create(dto: CreateBookingDto, actor: AuthenticatedUser) {
    let patientId = dto.patientId;
    let caregiverId = dto.caregiverId;
    let language = dto.language;
    if (dto.careRequestId) {
      const [req] = await this.db.select().from(careRequests).where(eq(careRequests.id, dto.careRequestId)).limit(1);
      if (!req) throw new NotFoundException('Request not found');
      if (req.status === 'CLOSED' || req.status === 'CANCELLED') {
        throw new BadRequestException('This request is no longer open - reopen it or book directly');
      }
      patientId = req.patientId;
      caregiverId = caregiverId ?? req.caregiverId ?? undefined;
      language = language ?? req.language;
    }
    if (!patientId) throw new BadRequestException('Choose the client');
    if (!caregiverId) throw new BadRequestException('Choose the caregiver');
    const [patient] = await this.db.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new NotFoundException('Client not found');
    await this.liveCaregiver(caregiverId);
    const generated = this.validatePattern(dto);

    const id = uuid();
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(bookings).values({
            id,
            reference: bookingReference(),
            careRequestId: dto.careRequestId ?? null,
            patientId: patientId!,
            caregiverId: caregiverId!,
            status: 'DRAFT',
            scheduleType: dto.scheduleType,
            daysOfWeek: BookingsService.daysString(dto.daysOfWeek),
            shiftStartTime: dto.shiftStartTime,
            shiftEndTime: dto.shiftEndTime,
            startDate: dto.startDate,
            endDate: dto.endDate,
            rateType: dto.rateType ?? null,
            rateAmount: dto.rateType ? (dto.rateAmount ?? null) : null,
            payRateType: dto.payRateType ?? null,
            payRateAmount: dto.payRateType ? (dto.payRateAmount ?? null) : null,
            language: language ?? 'en',
            notes: dto.notes ?? null,
            createdByUserId: actor.userId,
          });
          await this.insertShifts(tx as unknown as Tx, id, caregiverId!, generated, 'DRAFT', actor);
          await this.event(tx as unknown as Tx, id, 'CREATED', actor, `${generated.length} draft shifts`);
        });
        break;
      } catch (err) {
        if (isDuplicate(err, 'bookings_reference_unique') && attempt < 3) continue;
        throw err;
      }
    }
    return this.findOne(id);
  }

  private async insertShifts(
    db: Tx,
    bookingId: string,
    caregiverId: string,
    shifts: { startsAt: Date; endsAt: Date }[],
    status: ShiftStatus,
    actor: AuthenticatedUser,
  ) {
    for (let i = 0; i < shifts.length; i += 200) {
      await db.insert(bookingShifts).values(
        shifts.slice(i, i + 200).map((s) => ({
          id: uuid(),
          bookingId,
          caregiverId,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          status,
          updatedByUserId: actor.userId,
        })),
      );
    }
  }

  /**
   * The days a confirmed booking's change covers: from `effectiveFrom` (today
   * at the earliest) to the new last day. Shifts that have already started
   * are never regenerated, so slots before now are left out.
   */
  private validateReschedule(booking: { startDate: string; endDate: string }, from: string, pattern: BookingPatternDto | null, now: Date) {
    if (!isValidDate(from)) throw new BadRequestException('Enter the day the change starts');
    if (from < colomboToday(now)) throw new BadRequestException('A change can start today at the earliest - past shifts are edited one by one');
    if (from < booking.startDate) throw new BadRequestException('The change must start on or after the booking starts');
    const endDate = pattern?.endDate ?? booking.endDate;
    if (from > endDate) throw new BadRequestException('The change must start on or before the last day');
    if (!pattern) return null;
    if (pattern.startDate !== booking.startDate) {
      throw new BadRequestException("A confirmed booking's first day can't move - change it from a later day, or cancel and rebook");
    }
    if (!isValidDate(pattern.endDate)) throw new BadRequestException('Enter a valid last day');
    const days = (Date.parse(`${pattern.endDate}T00:00:00Z`) - Date.parse(`${booking.startDate}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_BOOKING_DAYS * 3) throw new BadRequestException('A booking can run for at most three years - start a new one');
    const generated = generateShifts({ ...pattern, startDate: from, daysOfWeek: pattern.daysOfWeek as IsoWeekday[] }).filter((g) => g.startsAt > now);
    if (generated.length > MAX_GENERATED_SHIFTS) throw new BadRequestException('A change can cover at most a year of shifts - extend the booking later instead');
    return generated;
  }

  /**
   * Edit a booking (see UpdateBookingDto for what may change when).
   *
   * The roster follows the plan in roster-plan.ts: shifts that still fit the
   * new pattern are kept as they are, with their edits and own rates. On a
   * confirmed booking the change runs from `effectiveFrom`; every shift that
   * would be held afterwards is checked against the caregivers' other shifts,
   * shifts already billed are never silently cancelled or moved, and the
   * client and the caregivers involved are told.
   */
  async update(id: string, dto: UpdateBookingDto, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
      throw new BadRequestException('This booking is closed and can no longer be changed');
    }
    const draft = booking.status === 'DRAFT';
    const now = new Date();
    const newCaregiverId = dto.caregiverId && dto.caregiverId !== booking.caregiverId ? await this.liveCaregiver(dto.caregiverId) : null;
    const reshaping = Boolean(dto.pattern || newCaregiverId);
    if (!draft && reshaping && !dto.effectiveFrom) throw new BadRequestException('Choose the day the change starts');

    const generated = !dto.pattern
      ? null
      : draft
        ? this.validatePattern(dto.pattern)
        : this.validateReschedule(booking, dto.effectiveFrom!, dto.pattern, now);
    if (!draft && reshaping && !dto.pattern) this.validateReschedule(booking, dto.effectiveFrom!, null, now);

    const rateType = dto.rateType === undefined ? booking.rateType : dto.rateType;
    const rateAmount = money(dto.rateAmount === undefined ? booking.rateAmount : dto.rateAmount);
    if (rateType && !rateAmount) throw new BadRequestException('Enter the agreed rate as a number');
    const payRateType = dto.payRateType === undefined ? booking.payRateType : dto.payRateType;
    const payRateAmount = money(dto.payRateAmount === undefined ? booking.payRateAmount : dto.payRateAmount);
    if (payRateType && !payRateAmount) throw new BadRequestException('Enter the pay rate as a number');

    // What changed, for the history.
    const rate = (t: typeof rateType, a: string | null) => (t && a ? describeRate({ type: t, amount: a }) : 'none');
    const changes: string[] = [];
    if (rate(rateType, rateType ? rateAmount : null) !== rate(booking.rateType, booking.rateAmount)) changes.push(`client rate: ${rate(rateType, rateAmount)}`);
    if (rate(payRateType, payRateType ? payRateAmount : null) !== rate(booking.payRateType, booking.payRateAmount)) changes.push(`pay rate: ${rate(payRateType, payRateAmount)}`);
    if (dto.language && dto.language !== booking.language) changes.push(`updates in ${dto.language}`);
    if (dto.notes !== undefined && (dto.notes.trim() || null) !== booking.notes) changes.push('notes');

    // Filled inside the transaction; sent only once it has committed.
    const after: { notify?: { from: string; caregiverIds: string[] } } = {};
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      // One edit of a booking at a time; then re-check it is still open.
      await t.execute(sql`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`);
      const current = await this.bookingOrThrow(id, t);
      if (current.status !== booking.status) throw new ConflictException('This booking was just changed by someone else - reload and try again');

      let rosterNote: string | null = null;
      if (reshaping) {
        const newBooked = newCaregiverId ?? booking.caregiverId;
        // Draft: the whole roster. Confirmed: scheduled shifts from the change on that haven't started.
        const fromInstant = draft ? null : new Date(Math.max(colomboToUtc(dto.effectiveFrom!, '00:00').getTime(), now.getTime()));
        const existing = (await tx
          .select()
          .from(bookingShifts)
          .where(
            draft
              ? and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'DRAFT'))
              : and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'SCHEDULED'), gte(bookingShifts.startsAt, fromInstant!)),
          )) as (ShiftRow & { payRateType: ShiftRateType | null })[];
        const plan = planRoster(existing, generated, booking.caregiverId, newBooked);
        const moved = plan.keep.filter((k) => k.caregiverId !== k.shift.caregiverId);

        if (!draft) {
          await this.lockCaregivers(t, [newBooked, booking.caregiverId, ...existing.map((s) => s.caregiverId)]);
          await this.assertNotBilled(t, plan.drop.map((s) => s.id), moved.map((m) => m.shift.id));
        }
        if (plan.drop.length) {
          const ids = plan.drop.map((s) => s.id);
          if (draft) await tx.delete(bookingShifts).where(inArray(bookingShifts.id, ids));
          else await tx.update(bookingShifts).set({ status: 'CANCELLED', updatedByUserId: actor.userId, updatedAt: now }).where(inArray(bookingShifts.id, ids));
        }
        for (const m of moved) {
          await tx.update(bookingShifts).set({ caregiverId: m.caregiverId, updatedByUserId: actor.userId, updatedAt: now }).where(eq(bookingShifts.id, m.shift.id));
        }
        const added = plan.add.map((a) => ({ id: uuid(), ...a }));
        for (let i = 0; i < added.length; i += 200) {
          await tx.insert(bookingShifts).values(
            added.slice(i, i + 200).map((a) => ({
              id: a.id,
              bookingId: id,
              caregiverId: a.caregiverId,
              startsAt: a.startsAt,
              endsAt: a.endsAt,
              status: (draft ? 'DRAFT' : 'SCHEDULED') as ShiftStatus,
              updatedByUserId: actor.userId,
            })),
          );
        }
        if (!draft) {
          // Everything the caregivers now hold from the change on must still fit around their other shifts.
          await this.assertNoOverlap(t, [
            ...plan.keep.map((k) => ({ ...k.shift, caregiverId: k.caregiverId, status: 'SCHEDULED' as ShiftStatus })),
            ...added.map((a) => ({ ...a, bookingId: id, status: 'SCHEDULED' as ShiftStatus })),
          ]);
        }

        const parts = [
          generated ? `${plan.keep.length} kept, ${plan.drop.length} ${draft ? 'removed' : 'cancelled'}, ${plan.add.length} added` : null,
          newCaregiverId ? `caregiver changed${moved.length ? ` on ${moved.length} shifts` : ''}` : null,
        ].filter(Boolean);
        rosterNote = draft ? parts.join('; ') : `from ${dto.effectiveFrom}: ${parts.join('; ')}`;
        if (!draft && (plan.drop.length || plan.add.length || moved.length)) {
          after.notify = {
            from: dto.effectiveFrom!,
            caregiverIds: [newBooked, ...plan.drop.map((s) => s.caregiverId), ...moved.flatMap((m) => [m.shift.caregiverId, m.caregiverId]), ...added.map((a) => a.caregiverId)],
          };
        }
      }

      await tx
        .update(bookings)
        .set({
          rateType: rateType ?? null,
          rateAmount: rateType ? rateAmount : null,
          payRateType: payRateType ?? null,
          payRateAmount: payRateType ? payRateAmount : null,
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.language ? { language: dto.language } : {}),
          ...(newCaregiverId ? { caregiverId: newCaregiverId } : {}),
          ...(dto.pattern
            ? {
                scheduleType: dto.pattern.scheduleType,
                daysOfWeek: BookingsService.daysString(dto.pattern.daysOfWeek),
                shiftStartTime: dto.pattern.shiftStartTime,
                shiftEndTime: dto.pattern.shiftEndTime,
                ...(draft ? { startDate: dto.pattern.startDate } : {}),
                endDate: dto.pattern.endDate,
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(bookings.id, id));

      const cleared = await this.clearMonthlyShiftRates(t, id);
      if (cleared) changes.push(`own rates cleared on ${cleared} shifts (now priced by the month)`);
      if (rosterNote !== null) await this.event(t, id, draft ? (generated ? 'REGENERATED' : 'UPDATED') : 'RESCHEDULED', actor, rosterNote);
      if (changes.length) await this.event(t, id, 'UPDATED', actor, changes.join('; '));
    }, CHECKED);

    if (after.notify) void this.notifier.bookingChanged(id, after.notify.from, after.notify.caregiverIds);
    return this.findOne(id);
  }

  /**
   * A shift folded into a monthly line is priced by the month, so it cannot
   * keep a rate of its own on that side: the client side of a MONTHLY booking,
   * and the booked caregiver's pay on a MONTHLY-pay one (covers are paid per
   * shift and keep theirs). Returns how many shifts lost a rate.
   */
  private async clearMonthlyShiftRates(db: Tx, bookingId: string) {
    const [b] = await db
      .select({ rateType: bookings.rateType, payRateType: bookings.payRateType, caregiverId: bookings.caregiverId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!b) return 0;
    const affected = (r: unknown) => (r as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
    let n = 0;
    if (b.rateType === 'MONTHLY') {
      n += affected(
        await db
          .update(bookingShifts)
          .set({ rateType: null, rateAmount: null })
          .where(and(eq(bookingShifts.bookingId, bookingId), isNotNull(bookingShifts.rateType))),
      );
    }
    if (b.payRateType === 'MONTHLY') {
      n += affected(
        await db
          .update(bookingShifts)
          .set({ payRateType: null, payRateAmount: null })
          .where(and(eq(bookingShifts.bookingId, bookingId), eq(bookingShifts.caregiverId, b.caregiverId), isNotNull(bookingShifts.payRateType))),
      );
    }
    return n;
  }

  /**
   * DRAFT -> CONFIRMED. Every draft shift becomes SCHEDULED, provided none of
   * them overlaps a shift the caregiver (or a cover) already holds. The
   * request it came from is closed as PLACED. Client and caregiver are told.
   */
  async confirm(id: string, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'DRAFT') throw new BadRequestException('Only a draft booking can be confirmed');

    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      // Lock first, then read: the drafts' caregivers are locked through the
      // shift rows themselves, so a cover added meanwhile is included.
      await t.execute(
        sql`SELECT id FROM caregivers WHERE id IN (SELECT caregiver_id FROM booking_shifts WHERE booking_id = ${id} AND status = 'DRAFT') ORDER BY id FOR UPDATE`,
      );
      const drafts = (await tx.select().from(bookingShifts).where(and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'DRAFT')))) as ShiftRow[];
      if (!drafts.length) throw new BadRequestException('Add at least one shift before confirming');
      await this.lockCaregivers(t, drafts.map((s) => s.caregiverId));
      await this.assertNoOverlap(t, drafts);

      const now = new Date();
      const result = await tx
        .update(bookings)
        .set({ status: 'CONFIRMED', confirmedAt: now, confirmedByUserId: actor.userId, updatedAt: now })
        .where(and(eq(bookings.id, id), eq(bookings.status, 'DRAFT')));
      if ((result as unknown as [{ affectedRows: number }])[0]?.affectedRows === 0) {
        throw new ConflictException('This booking was just changed by someone else - reload and try again');
      }
      await tx.update(bookingShifts).set({ status: 'SCHEDULED', updatedAt: now }).where(and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'DRAFT')));
      await this.event(t, id, 'CONFIRMED', actor, `${drafts.length} shifts scheduled`);

      if (booking.careRequestId) {
        const [req] = await tx
          .select({ status: careRequests.status })
          .from(careRequests)
          .where(eq(careRequests.id, booking.careRequestId))
          .limit(1);
        if (req && (req.status === 'NEW' || req.status === 'IN_PROGRESS' || req.status === 'INTRODUCED')) {
          await tx
            .update(careRequests)
            .set({ status: 'CLOSED', closeReason: 'PLACED', closedAt: now, updatedAt: now })
            .where(eq(careRequests.id, booking.careRequestId));
          await tx.insert(careRequestEvents).values({
            id: uuid(),
            requestId: booking.careRequestId,
            type: 'STATUS_CHANGED',
            fromStatus: req.status,
            toStatus: 'CLOSED',
            closeReason: 'PLACED',
            note: `Booking ${booking.reference} confirmed`,
            actorUserId: actor.userId,
          });
        }
      }
    }, CHECKED);

    void this.notifier.bookingConfirmed(id);
    return this.findOne(id);
  }

  /** Called off: every draft and every shift still to come is cancelled. */
  async cancel(id: string, reason: string, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is already closed');
    if (!reason?.trim()) throw new BadRequestException('Say why the booking is being cancelled');
    const now = new Date();
    if (booking.status === 'CONFIRMED') await this.assertUpcomingNotBilled(id, now);
    await this.db.transaction(async (tx) => {
      await tx.update(bookings).set({ status: 'CANCELLED', cancelledAt: now, cancelReason: reason.trim(), updatedAt: now }).where(eq(bookings.id, id));
      await tx
        .update(bookingShifts)
        .set({ status: 'CANCELLED', updatedAt: now, updatedByUserId: actor.userId })
        .where(
          and(
            eq(bookingShifts.bookingId, id),
            or(eq(bookingShifts.status, 'DRAFT'), and(eq(bookingShifts.status, 'SCHEDULED'), gt(bookingShifts.startsAt, now))),
          ),
        );
      await this.event(tx as unknown as Tx, id, 'CANCELLED', actor, reason.trim());
    });
    if (booking.status === 'CONFIRMED') void this.notifier.bookingCancelled(id);
    return this.findOne(id);
  }

  /** The engagement is over. Shifts still to come are cancelled; past ones keep their status. */
  /**
   * Closing a booking cancels its upcoming scheduled shifts. When some of
   * those are already on an invoice (billed in advance) or a pay statement,
   * a plain close would leave the document billing work that will not
   * happen - so it is refused, and the close goes through a correction
   * (POST /bookings/:id/amendments with `close`), which adjusts the document.
   */
  private async assertUpcomingNotBilled(id: string, now: Date) {
    const upcoming = await this.db
      .select({ id: bookingShifts.id })
      .from(bookingShifts)
      .where(and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'SCHEDULED'), gt(bookingShifts.startsAt, now)));
    const refs = await this.billingRefs(upcoming.map((s) => s.id));
    const docs = new Set<string>();
    for (const i of refs.invoices.values()) docs.add(i.number ? `invoice ${i.number}` : 'a draft invoice');
    for (const p of refs.payouts.values()) docs.add(`pay statement ${p.reference}`);
    if (docs.size) {
      throw new ConflictException(`Upcoming shifts of this booking are already on ${[...docs].join(', ')} - close it through Correct, so the documents are adjusted with it`);
    }
  }

  async complete(id: string, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'CONFIRMED') throw new BadRequestException('Only a confirmed booking can be completed');
    const now = new Date();
    await this.assertUpcomingNotBilled(id, now);
    await this.db.transaction(async (tx) => {
      await tx.update(bookings).set({ status: 'COMPLETED', completedAt: now, updatedAt: now }).where(eq(bookings.id, id));
      await tx
        .update(bookingShifts)
        .set({ status: 'CANCELLED', updatedAt: now, updatedByUserId: actor.userId })
        .where(and(eq(bookingShifts.bookingId, id), eq(bookingShifts.status, 'SCHEDULED'), gt(bookingShifts.startsAt, now)));
      await this.event(tx as unknown as Tx, id, 'COMPLETED', actor);
    });
    return this.findOne(id);
  }

  /**
   * A later end date: the pattern runs on from the day after the old end. On a
   * confirmed booking the new shifts are scheduled straight away, so they must
   * fit around everything the caregiver already holds.
   */
  async extend(id: string, endDate: string, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is closed and can no longer be changed');
    if (!isValidDate(endDate) || endDate <= booking.endDate) throw new BadRequestException('The new end date must be after the current one');
    const generated = generateShifts({
      startDate: addDays(booking.endDate, 1),
      endDate,
      daysOfWeek: booking.daysOfWeek.split(',').map(Number) as IsoWeekday[],
      shiftStartTime: booking.shiftStartTime,
      shiftEndTime: booking.shiftEndTime,
    });
    const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${booking.startDate}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_BOOKING_DAYS * 3) throw new BadRequestException('A booking can run for at most three years - start a new one');
    if (generated.length > MAX_GENERATED_SHIFTS) throw new BadRequestException('A booking can cover at most a year - extend it later if needed');
    const status: ShiftStatus = booking.status === 'DRAFT' ? 'DRAFT' : 'SCHEDULED';

    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      if (status === 'SCHEDULED' && generated.length) {
        await this.lockCaregivers(t, [booking.caregiverId]);
        await this.assertNoOverlap(
          t,
          generated.map((g, i) => ({ id: `new-${i}`, bookingId: id, caregiverId: booking.caregiverId, startsAt: g.startsAt, endsAt: g.endsAt, status })),
        );
      }
      await tx.update(bookings).set({ endDate, updatedAt: new Date() }).where(eq(bookings.id, id));
      if (generated.length) await this.insertShifts(t, id, booking.caregiverId, generated, status, actor);
      await this.event(t, id, 'EXTENDED', actor, `to ${endDate}: ${generated.length} new shifts`);
    }, CHECKED);
    return this.findOne(id);
  }

  // --- single shifts -----------------------------------------------------------

  parseRange(start: string, end: string) {
    const s = colomboLocalToIso(start);
    const e = colomboLocalToIso(end);
    if (!s || !e) throw new BadRequestException('Enter valid start and end times');
    const startsAt = new Date(s);
    const endsAt = new Date(e);
    if (endsAt <= startsAt) throw new BadRequestException('A shift must end after it starts');
    if (endsAt.getTime() - startsAt.getTime() > MAX_SHIFT_HOURS * 3_600_000) throw new BadRequestException('A single shift can be at most 24 hours');
    return { startsAt, endsAt };
  }

  /**
   * A shift's own rates after an edit. Each side is left alone when the edit
   * doesn't mention it, set when it gives a type and amount, and cleared with
   * null. A side folded into a monthly line can't have one (see
   * clearMonthlyShiftRates): asking for it is refused; a rate the shift
   * already had is dropped when it moves back to the booked caregiver.
   */
  resolveShiftRates(
    booking: { rateType: RateTypeValue | null; payRateType: RateTypeValue | null; caregiverId: string },
    caregiverId: string,
    dto: { rateType?: ShiftRateType | null; rateAmount?: string | null; payRateType?: ShiftRateType | null; payRateAmount?: string | null },
    current: { rateType: ShiftRateType | null; rateAmount: string | null; payRateType: ShiftRateType | null; payRateAmount: string | null } | null,
  ) {
    const side = (
      type: ShiftRateType | null | undefined,
      amount: string | null | undefined,
      had: { type: ShiftRateType | null; amount: string | null },
      monthly: boolean,
      monthlyMessage: string,
      amountMessage: string,
    ) => {
      const asked = type !== undefined || amount !== undefined;
      const nextType = type === undefined ? had.type : type;
      const nextAmount = nextType ? (amount === undefined ? had.amount : amount) : null;
      if (nextType && !nextAmount) throw new BadRequestException(amountMessage);
      if (nextType && monthly) {
        if (asked) throw new BadRequestException(monthlyMessage);
        return { type: null, amount: null };
      }
      return { type: nextType ?? null, amount: nextType ? money(nextAmount) : null };
    };
    const client = side(
      dto.rateType,
      dto.rateAmount,
      { type: current?.rateType ?? null, amount: current?.rateAmount ?? null },
      booking.rateType === 'MONTHLY',
      'This booking is charged by the month, so a single shift cannot have its own client rate - adjust the invoice instead',
      'Enter the shift rate as a number',
    );
    const pay = side(
      dto.payRateType,
      dto.payRateAmount,
      { type: current?.payRateType ?? null, amount: current?.payRateAmount ?? null },
      booking.payRateType === 'MONTHLY' && caregiverId === booking.caregiverId,
      'The booked caregiver is paid by the month on this booking - only a cover can be paid a rate for a single shift',
      'Enter the shift pay as a number',
    );
    return { rateType: client.type, rateAmount: client.amount, payRateType: pay.type, payRateAmount: pay.amount };
  }

  async addShift(id: string, dto: AddShiftDto, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is closed and can no longer be changed');
    const { startsAt, endsAt } = this.parseRange(dto.start, dto.end);
    const caregiverId = dto.caregiverId ? await this.liveCaregiver(dto.caregiverId) : booking.caregiverId;
    const status: ShiftStatus = booking.status === 'DRAFT' ? 'DRAFT' : 'SCHEDULED';
    const rates = this.resolveShiftRates(booking, caregiverId, dto, null);
    const shiftId = uuid();

    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      if (status === 'SCHEDULED') {
        await this.lockCaregivers(t, [caregiverId]);
        await this.assertNoOverlap(t, [{ id: shiftId, bookingId: id, caregiverId, startsAt, endsAt, status }]);
      }
      await tx.insert(bookingShifts).values({ id: shiftId, bookingId: id, caregiverId, startsAt, endsAt, status, note: dto.note ?? null, ...rates, updatedByUserId: actor.userId });
      const own = [
        rates.rateType ? `client ${describeRate({ type: rates.rateType, amount: rates.rateAmount! })}` : null,
        rates.payRateType ? `pay ${describeRate({ type: rates.payRateType, amount: rates.payRateAmount! })}` : null,
      ].filter(Boolean);
      await this.event(t, id, 'SHIFT_ADDED', actor, `${dto.start} - ${dto.end}${own.length ? ` (${own.join(', ')})` : ''}`);
    }, CHECKED);
    return this.findOne(id);
  }

  /**
   * One shift: new times (to the minute), a cover caregiver, a status (done,
   * missed, cancelled, or back to scheduled), or a note. Whatever the result,
   * a shift that holds the caregiver's time may not overlap another one.
   */
  async updateShift(id: string, shiftId: string, dto: UpdateShiftDto, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is closed and can no longer be changed');
    const [shift] = (await this.db
      .select()
      .from(bookingShifts)
      .where(and(eq(bookingShifts.id, shiftId), eq(bookingShifts.bookingId, id)))
      .limit(1)) as (ShiftRow & {
      note: string | null;
      rateType: ShiftRateType | null;
      rateAmount: string | null;
      payRateType: ShiftRateType | null;
      payRateAmount: string | null;
    })[];
    if (!shift) throw new NotFoundException('Shift not found');

    let startsAt = new Date(shift.startsAt);
    let endsAt = new Date(shift.endsAt);
    if (dto.start || dto.end) {
      const range = this.parseRange(dto.start ?? isoLocal(startsAt), dto.end ?? isoLocal(endsAt));
      startsAt = range.startsAt;
      endsAt = range.endsAt;
    }
    let status = shift.status;
    if (dto.status && dto.status !== shift.status) {
      if (!SHIFT_STATUS_TRANSITIONS[shift.status].includes(dto.status)) {
        throw new BadRequestException(
          shift.status === 'DRAFT' ? 'Draft shifts are scheduled by confirming the booking' : 'This shift cannot be moved to that status',
        );
      }
      if ((dto.status === 'COMPLETED' || dto.status === 'MISSED') && startsAt > new Date()) {
        throw new BadRequestException('A shift can only be marked done or missed once it has started');
      }
      status = dto.status;
    }
    const caregiverId = dto.caregiverId ? await this.liveCaregiver(dto.caregiverId) : shift.caregiverId;
    const rates = this.resolveShiftRates(booking, caregiverId, dto, shift);
    // Only times, caregiver or status can create an overlap; a rate or note change alone needs no check.
    const timeOrHolder = startsAt.getTime() !== new Date(shift.startsAt).getTime() || endsAt.getTime() !== new Date(shift.endsAt).getTime() || caregiverId !== shift.caregiverId || status !== shift.status;
    const ratesChanged =
      rates.rateType !== shift.rateType || rates.rateAmount !== shift.rateAmount || rates.payRateType !== shift.payRateType || rates.payRateAmount !== shift.payRateAmount;
    // Marking a scheduled shift done changes no money (an invoice billed in
    // advance already counts it). Anything else on a shift that is already on
    // an invoice or pay statement goes through a correction, which adjusts the
    // document with it - otherwise the bill would quietly stop matching the roster.
    const moneyNeutral = !ratesChanged && (!timeOrHolder || (shift.status === 'SCHEDULED' && status === 'COMPLETED' && caregiverId === shift.caregiverId && startsAt.getTime() === new Date(shift.startsAt).getTime() && endsAt.getTime() === new Date(shift.endsAt).getTime()));
    if (!moneyNeutral) {
      const refs = await this.billingRefs([shift.id]);
      const inv = refs.invoices.get(shift.id);
      const pay = refs.payouts.get(shift.id);
      if (inv || pay) {
        const on = [inv ? (inv.number ? `invoice ${inv.number}` : 'a draft invoice') : null, pay ? `pay statement ${pay.reference}` : null].filter(Boolean).join(' and ');
        throw new ConflictException(`This shift is already on ${on} - use Correct on the booking, so the document is adjusted with it`);
      }
    }

    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      if (timeOrHolder && BLOCKING_SHIFT_STATUSES.includes(status)) {
        await this.lockCaregivers(t, [caregiverId]);
        await this.assertNoOverlap(t, [{ id: shift.id, bookingId: id, caregiverId, startsAt, endsAt, status }]);
      }
      await tx
        .update(bookingShifts)
        .set({
          startsAt,
          endsAt,
          caregiverId,
          status,
          ...rates,
          ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
          updatedByUserId: actor.userId,
          updatedAt: new Date(),
        })
        .where(eq(bookingShifts.id, shift.id));
      const changes = [
        dto.start || dto.end ? `${isoLocal(startsAt)} - ${isoLocal(endsAt)}` : null,
        caregiverId !== shift.caregiverId ? (caregiverId === booking.caregiverId ? 'back to the booked caregiver' : 'cover caregiver assigned') : null,
        status !== shift.status ? `${shift.status} -> ${status}` : null,
        rates.rateType !== shift.rateType || rates.rateAmount !== shift.rateAmount
          ? `client rate: ${describeRate(rates.rateType ? { type: rates.rateType, amount: rates.rateAmount! } : null)}`
          : null,
        rates.payRateType !== shift.payRateType || rates.payRateAmount !== shift.payRateAmount
          ? `pay rate: ${describeRate(rates.payRateType ? { type: rates.payRateType, amount: rates.payRateAmount! } : null)}`
          : null,
      ].filter(Boolean);
      if (changes.length) await this.event(t, id, 'SHIFT_CHANGED', actor, `${isoLocal(new Date(shift.startsAt)).slice(0, 10)}: ${changes.join('; ')}`);
    }, CHECKED);
    return this.findOne(id);
  }

  /** Only drafts are deleted outright; a scheduled shift is cancelled instead, so its history stays. */
  async removeShift(id: string, shiftId: string, actor: AuthenticatedUser) {
    const booking = await this.bookingOrThrow(id);
    const [shift] = await this.db
      .select({ status: bookingShifts.status, startsAt: bookingShifts.startsAt })
      .from(bookingShifts)
      .where(and(eq(bookingShifts.id, shiftId), eq(bookingShifts.bookingId, id)))
      .limit(1);
    if (!shift) throw new NotFoundException('Shift not found');
    if (booking.status !== 'DRAFT' || shift.status !== 'DRAFT') {
      throw new BadRequestException('Only draft shifts can be removed - cancel a scheduled shift instead');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(bookingShifts).where(eq(bookingShifts.id, shiftId));
      await this.event(tx as unknown as Tx, id, 'SHIFT_REMOVED', actor, isoLocal(new Date(shift.startsAt)));
    });
    return this.findOne(id);
  }

  async addNote(id: string, note: string, actor: AuthenticatedUser) {
    if (!note?.trim()) throw new BadRequestException('Write a note first');
    await this.bookingOrThrow(id);
    await this.event(this.db, id, 'NOTE', actor, note.trim());
    return this.findOne(id);
  }

  // --- the people in it ----------------------------------------------------------

  /** A client's bookings - never drafts - with the caregiver's public profile and their shifts from a week ago on. */
  async listForClient(user: AuthenticatedUser, locale?: string): Promise<ClientBooking[]> {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) throw new ForbiddenException('You do not have permission to perform this action');
    const rows = await this.db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        scheduleType: bookings.scheduleType,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        rateType: bookings.rateType,
        rateAmount: bookings.rateAmount,
        caregiverId: bookings.caregiverId,
        caregiverPublicId: caregivers.publicId,
      })
      .from(bookings)
      .innerJoin(caregivers, eq(bookings.caregiverId, caregivers.id))
      .where(and(eq(bookings.patientId, user.patientId), ne(bookings.status, 'DRAFT')))
      .orderBy(desc(bookings.startDate))
      .limit(50);
    if (!rows.length) return [];

    const since = new Date(Date.now() - 7 * 86_400_000);
    const [shifts, profiles] = await Promise.all([
      this.db
        .select()
        .from(bookingShifts)
        .where(and(inArray(bookingShifts.bookingId, rows.map((r) => r.id)), ne(bookingShifts.status, 'DRAFT'), gte(bookingShifts.endsAt, since)))
        .orderBy(asc(bookingShifts.startsAt)),
      this.publicSearch.profilesFor(rows.map((r) => r.caregiverId), locale),
    ]);
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      scheduleType: r.scheduleType,
      startDate: r.startDate,
      endDate: r.endDate,
      rateType: r.rateType,
      rateAmount: r.rateAmount,
      caregiverPublicId: r.caregiverPublicId,
      caregiver: profiles.get(r.caregiverId) ?? null,
      shifts: shifts
        .filter((s) => s.bookingId === r.id)
        .slice(0, 60)
        .map((s) => ({
          id: s.id,
          startsAt: new Date(s.startsAt).toISOString(),
          endsAt: new Date(s.endsAt).toISOString(),
          status: s.status,
          isCover: s.caregiverId !== r.caregiverId,
        })),
    }));
  }

  /**
   * A caregiver's own shifts - covers included - from a week ago to two months
   * ahead, from confirmed bookings only. The client is named by area only;
   * staff share the address when they arrange it.
   */
  async listForCaregiver(user: AuthenticatedUser): Promise<CaregiverShift[]> {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('You do not have permission to perform this action');
    const now = Date.now();
    const rows = await this.db
      .select({
        id: bookingShifts.id,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        bookedCaregiverId: bookings.caregiverId,
        reference: bookings.reference,
        scheduleType: bookings.scheduleType,
        city: cities.nameEn,
        district: districts.nameEn,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .innerJoin(patients, eq(bookings.patientId, patients.id))
      .leftJoin(cities, eq(patients.cityId, cities.id))
      .leftJoin(districts, eq(patients.districtId, districts.id))
      .where(
        and(
          eq(bookingShifts.caregiverId, user.caregiverId),
          ne(bookingShifts.status, 'DRAFT'),
          ne(bookings.status, 'DRAFT'),
          gte(bookingShifts.endsAt, new Date(now - 7 * 86_400_000)),
          lt(bookingShifts.startsAt, new Date(now + 62 * 86_400_000)),
        ),
      )
      .orderBy(asc(bookingShifts.startsAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      startsAt: new Date(r.startsAt).toISOString(),
      endsAt: new Date(r.endsAt).toISOString(),
      status: r.status,
      isCover: r.bookedCaregiverId !== user.caregiverId,
      bookingReference: r.reference,
      scheduleType: r.scheduleType,
      area: [r.city, r.district].filter(Boolean).join(', ') || null,
    }));
  }
}

/** An instant as a Colombo datetime-local string, for messages and history. */
const isoLocal = (d: Date) => isoToColomboLocal(d);
const toColomboDate = (d: Date) => isoToColomboLocal(d).slice(0, 10);

type RateTypeValue = 'HOURLY' | 'DAILY' | 'MONTHLY';
/** Amounts as stored ("3500" -> "3500.00"), so an unchanged rate never reads as a change. */
const money = (a: string | null | undefined) => (a === null || a === undefined || a === '' ? null : Number(a).toFixed(2));
type Rate = { type: ShiftRateType | RateTypeValue; amount: string } | null;
/** "LKR 5,000.00 per hour" - for the booking's history. */
const describeRate = (r: Rate) => (r ? `${formatLkr(r.amount)} ${{ HOURLY: 'per hour', DAILY: 'per shift', MONTHLY: 'per month' }[r.type]}` : 'booking rate');
