import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import {
  EXPIRY_FINAL_WARNING_DAYS,
  EXPIRY_WARNING_DAYS,
  expiryState,
  type CaregiverExpiringDocument,
  type StaffExpiringDocument,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverDocuments, caregiverOverseasProfiles, caregivers, documentExpiryReminders, placementInvoices, users, type ExpiryReminderStage } from '../database/schema';
import { InternationalNotifier } from './international-notifier.service';
import { PlacementsService } from './placements.service';
import { addDays, todayColombo } from './dates';

/** Expired documents are chased for this long, then left to staff: no point emailing about a passport that lapsed years ago. */
const EXPIRED_REMINDER_WINDOW_DAYS = 30;
/** How often the sweep wakes. It does real work at most once per Colombo day. */
const TICK_MS = 60 * 60_000;
/** Reminders go out in office hours, Sri Lanka time. */
const EARLIEST_HOUR = 8;

const DOCUMENT_NAMES: Record<string, string> = {
  PASSPORT: 'passport',
  NIC: 'national identity card',
  GRAMA_NILADHARI_CERTIFICATE: 'Grama Niladhari certificate',
  POLICE_CLEARANCE: 'police clearance certificate',
  CAREGIVER_CERTIFICATE: 'caregiver certificate',
  NVQ_CERTIFICATE: 'NVQ certificate',
  NURSING_CERTIFICATE: 'nursing certificate',
  CV: 'CV',
  OTHER: 'document',
};

interface Dated {
  caregiverId: string;
  key: string;
  documentType: string;
  expiresOn: string;
}

/** Which reminder a document is due, if any, given how many days it has left. */
export function reminderStage(daysLeft: number): ExpiryReminderStage | null {
  if (daysLeft < -EXPIRED_REMINDER_WINDOW_DAYS) return null;
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= EXPIRY_FINAL_WARNING_DAYS) return 'DAYS_30';
  if (daysLeft <= EXPIRY_WARNING_DAYS) return 'DAYS_90';
  return null;
}

/**
 * Passports and dated documents running out - the thing most likely to stop
 * a caregiver travelling, or to leave one abroad without valid papers.
 *
 * A daily sweep emails each caregiver at 90 and 30 days before a document
 * expires, and once after, and sends staff one digest: new expiries, overdue
 * welfare check-ins and overdue placement invoices. Each reminder is logged
 * so it goes out once; a renewed document (a new date) starts again.
 */
@Injectable()
export class DocumentExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DocumentExpiryService.name);
  private timers: NodeJS.Timeout[] = [];
  private lastRunDay: string | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly placements: PlacementsService,
    private readonly notifier: InternationalNotifier,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('EXPIRY_REMINDERS_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((err) => this.logger.warn(`Expiry sweep failed: ${(err as Error).message}`));
    const first = setTimeout(tick, 60_000);
    const every = setInterval(tick, TICK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** Once per Colombo day, after office hours start. */
  private async tick(now = Date.now()) {
    const today = todayColombo(now);
    const hour = new Date(now + 5.5 * 3600_000).getUTCHours();
    if (hour < EARLIEST_HOUR || this.lastRunDay === today) return;
    this.lastRunDay = today;
    await this.sweep(today);
  }

  // --- reads ---------------------------------------------------------------------

  async forCaregiver(caregiverId: string, today = todayColombo()): Promise<CaregiverExpiringDocument[]> {
    const items = await this.dated({ caregiverId });
    return items
      .map((d) => ({ key: d.key, documentType: d.documentType, expiresOn: d.expiresOn, ...expiryState(d.expiresOn, today) }))
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  }

  /** Everything expired or expiring within the window, soonest first. */
  async staffList(withinDays = EXPIRY_WARNING_DAYS, today = todayColombo()): Promise<StaffExpiringDocument[]> {
    const [items, placed] = await Promise.all([this.dated({ before: addDays(today, withinDays) }), this.placements.activeCaregiverIds()]);
    const people = await this.people(items.map((i) => i.caregiverId));
    return items
      .filter((d) => people.has(d.caregiverId))
      .map((d) => ({
        key: d.key,
        documentType: d.documentType,
        expiresOn: d.expiresOn,
        ...expiryState(d.expiresOn, today),
        caregiverId: d.caregiverId,
        registrationNumber: people.get(d.caregiverId)!.registrationNumber,
        fullName: people.get(d.caregiverId)!.fullName,
        placed: placed.has(d.caregiverId),
      }))
      .sort((a, b) => Number(b.placed) - Number(a.placed) || a.expiresOn.localeCompare(b.expiresOn));
  }

  // --- the sweep -------------------------------------------------------------------

  /** Sends what is due today. Safe to run more than once a day: every reminder is sent once. */
  async sweep(today = todayColombo()): Promise<{ reminders: number; overdueCheckins: number; overdueInvoices: number }> {
    // Each reminder is logged under a unique key before it is sent, so two
    // sweeps at once (a second API copy, say) can never email anyone twice.
    const items = await this.dated({ before: addDays(today, EXPIRY_WARNING_DAYS) });
    const sent: (Dated & { stage: ExpiryReminderStage; daysLeft: number })[] = [];
    for (const d of items) {
      const { daysLeft } = expiryState(d.expiresOn, today);
      const stage = reminderStage(daysLeft);
      if (!stage) continue;
      const inserted = await this.logOnce(d, stage);
      if (!inserted) continue;
      sent.push({ ...d, stage, daysLeft });
      await this.remindCaregiver(d, stage);
    }
    const [checkins, invoices] = await Promise.all([this.placements.overdueCheckins(today), this.overdueInvoices(today)]);
    if (sent.length || checkins.length || invoices.length) await this.digest(sent, checkins, invoices);
    this.logger.log(`Expiry sweep ${today}: ${sent.length} reminder(s), ${checkins.length} overdue check-in(s), ${invoices.length} overdue invoice(s)`);
    return { reminders: sent.length, overdueCheckins: checkins.length, overdueInvoices: invoices.length };
  }

  // --- internals ---------------------------------------------------------------------

  /**
   * Passports (for caregivers who said they want to work abroad - the only
   * reason we hold the date) and uploads that have an expiry date and were
   * not rejected.
   */
  private async dated(filter: { caregiverId?: string; before?: string }): Promise<Dated[]> {
    const [passports, docs] = await Promise.all([
      this.db
        .select({ caregiverId: caregiverOverseasProfiles.caregiverId, expiresOn: caregiverOverseasProfiles.passportExpiry })
        .from(caregiverOverseasProfiles)
        .where(
          and(
            eq(caregiverOverseasProfiles.passportHeld, true),
            isNotNull(caregiverOverseasProfiles.passportExpiry),
            filter.caregiverId ? eq(caregiverOverseasProfiles.caregiverId, filter.caregiverId) : eq(caregiverOverseasProfiles.openToOverseas, true),
            filter.before ? lte(caregiverOverseasProfiles.passportExpiry, filter.before) : undefined,
          ),
        ),
      this.db
        .select({ id: caregiverDocuments.id, caregiverId: caregiverDocuments.caregiverId, documentType: caregiverDocuments.documentType, expiresOn: caregiverDocuments.expiresOn })
        .from(caregiverDocuments)
        .where(
          and(
            isNotNull(caregiverDocuments.expiresOn),
            ne(caregiverDocuments.verificationStatus, 'REJECTED'),
            filter.caregiverId ? eq(caregiverDocuments.caregiverId, filter.caregiverId) : undefined,
            filter.before ? lte(caregiverDocuments.expiresOn, filter.before) : undefined,
          ),
        ),
    ]);
    // A passport uploaded with a date is the same passport as the one on the
    // Work abroad form: count the form's date only when no upload carries one.
    const passportUploads = new Set(docs.filter((d) => d.documentType === 'PASSPORT').map((d) => d.caregiverId));
    return [
      ...passports.filter((p) => !passportUploads.has(p.caregiverId)).map((p) => ({ caregiverId: p.caregiverId, key: 'PASSPORT', documentType: 'PASSPORT', expiresOn: p.expiresOn! })),
      ...docs.map((d) => ({ caregiverId: d.caregiverId, key: d.id, documentType: d.documentType, expiresOn: d.expiresOn! })),
    ];
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, { registrationNumber: string; fullName: string }>();
    const rows = await this.db
      .select({ id: caregivers.id, registrationNumber: caregivers.registrationNumber, fullName: caregivers.fullName })
      .from(caregivers)
      .where(and(inArray(caregivers.id, unique), isNull(caregivers.deletedAt)));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async logOnce(d: Dated, stage: ExpiryReminderStage): Promise<boolean> {
    const subject = d.key === 'PASSPORT' ? 'PASSPORT' : `DOC:${d.key}`;
    try {
      await this.db.insert(documentExpiryReminders).values({ id: uuid(), caregiverId: d.caregiverId, subject, expiresOn: d.expiresOn, stage });
      return true;
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === 'ER_DUP_ENTRY') return false;
      throw err;
    }
  }

  private async remindCaregiver(d: Dated, stage: ExpiryReminderStage) {
    const [row] = await this.db
      .select({ email: users.email, fullName: caregivers.fullName, deletedAt: caregivers.deletedAt })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, d.caregiverId))
      .limit(1);
    if (!row || row.deletedAt) return;
    const what = DOCUMENT_NAMES[d.documentType] ?? 'document';
    const first =
      stage === 'EXPIRED'
        ? `Your ${what} expired on ${d.expiresOn}.`
        : `Your ${what} expires on ${d.expiresOn}${stage === 'DAYS_30' ? ' - in less than a month' : ''}.`;
    const next =
      d.documentType === 'PASSPORT'
        ? 'Most countries need a passport valid for at least six months to issue a work visa. Renew it in good time, then update the expiry date in your Work abroad section.'
        : 'Get a new one in good time and upload it, so our team can verify it before the old one runs out.';
    await this.notifier.toAddress(row.email, `expiry ${stage} ${d.documentType}`, {
      subject: stage === 'EXPIRED' ? `Your ${what} has expired` : `Your ${what} expires soon`,
      paragraphs: [first, next],
      cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') },
    });
  }

  private overdueInvoices(today: string) {
    return this.db
      .select({ number: placementInvoices.number, billToName: placementInvoices.billToName, dueDate: placementInvoices.dueDate, currency: placementInvoices.currency, amount: placementInvoices.amount })
      .from(placementInvoices)
      .where(and(eq(placementInvoices.status, 'ISSUED'), lt(placementInvoices.dueDate, today)))
      .limit(100);
  }

  private async digest(
    sent: (Dated & { stage: ExpiryReminderStage; daysLeft: number })[],
    checkins: Awaited<ReturnType<PlacementsService['overdueCheckins']>>,
    invoices: Awaited<ReturnType<DocumentExpiryService['overdueInvoices']>>,
  ) {
    const people = await this.people(sent.map((s) => s.caregiverId));
    const lines: string[] = [];
    if (sent.length) {
      lines.push(`Expiry reminders sent today (${sent.length}):`);
      for (const s of sent.slice(0, 30)) {
        const who = people.get(s.caregiverId);
        lines.push(`- ${who?.fullName ?? 'A caregiver'} (${who?.registrationNumber ?? '?'}): ${DOCUMENT_NAMES[s.documentType] ?? 'document'} ${s.daysLeft < 0 ? 'expired' : 'expires'} ${s.expiresOn}`);
      }
    }
    if (checkins.length) {
      lines.push(`Welfare check-ins overdue (${checkins.length}):`);
      for (const c of checkins.slice(0, 30)) lines.push(`- ${c.fullName} in ${c.country}: ${c.kind.replace('_', ' ').toLowerCase()} check-in was due ${c.dueOn}`);
    }
    if (invoices.length) {
      lines.push(`Placement invoices overdue (${invoices.length}):`);
      for (const i of invoices.slice(0, 30)) lines.push(`- ${i.number} to ${i.billToName}: ${i.currency} ${i.amount}, due ${i.dueDate}`);
    }
    await this.notifier.toStaff('overseas daily digest', {
      subject: 'Overseas: today’s follow-ups',
      paragraphs: lines,
      cta: { label: 'Open Overseas', url: this.notifier.staffUrl('/international?tab=placements') },
    });
  }
}
