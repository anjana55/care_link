import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, like, ne } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { UNPAID_ALERT_DAYS_BEFORE_START, addDays, advancePeriods, colomboToday } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingEvents, bookings, invoices, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { nudgeBookingConfirm } from '../bookings/booking-agent-jobs';
import { InvoicesService } from './invoices.service';
import { INVOICE_PAID_JOB, UNPAID_SWEEP_JOB } from './advance-payment-jobs';

const HOUR_MS = 60 * 60 * 1000;
/** Written to the booking's history when staff are alerted, and looked for so they are alerted once. */
const ALERTED = 'Staff alerted: the first invoice is not paid';

/**
 * Payment before confirmation, for bookings billed in advance.
 *
 * A draft billed in advance gets its first invoice (the booking's first
 * month) while it is still a draft, and is confirmed once that is paid.
 * This service sends that invoice when staff ask, tells staff when it has
 * been paid (and nudges the booking agent, which confirms when it is on), and
 * alerts staff once when it is overdue or the booking is about to start
 * unpaid. Confirming without payment is a staff decision, made on the booking
 * with a reason; nothing here ever does it.
 *
 * None of this depends on an automation dial: it is how the manual flow works.
 * With the agents on, the billing agent sends the invoice as soon as the
 * client accepts the draft, and the booking agent confirms after payment.
 */
@Injectable()
export class AdvancePaymentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AdvancePaymentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly invoicesService: InvoicesService,
    private readonly automation: AutomationService,
    private readonly jobs: JobsService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  onApplicationBootstrap() {
    this.jobs.register(INVOICE_PAID_JOB, async (payload) => {
      const invoiceId = (payload as { invoiceId?: unknown }).invoiceId;
      if (typeof invoiceId === 'string') await this.onPaid(invoiceId);
    });
    this.jobs.register(UNPAID_SWEEP_JOB, async () => void (await this.alertUnpaid()));
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    const queue = () =>
      void this.jobs.enqueue(UNPAID_SWEEP_JOB, {}, { uniqueKey: `${UNPAID_SWEEP_JOB}:${Math.floor(Date.now() / HOUR_MS)}`, maxAttempts: 2 }).catch((e) => this.logger.warn(`Unpaid-booking check not queued: ${(e as Error).message}`));
    this.timer = setInterval(queue, HOUR_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Makes and issues the first invoice of a draft billed in advance: its first month, for the work booked. The client is told, with the way to pay. */
  async send(bookingId: string, actor: AuthenticatedUser, now = new Date()) {
    const [b] = await this.db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!b) throw new NotFoundException('Booking not found');
    if (b.status !== 'DRAFT' || b.billingTiming !== 'ADVANCE') throw new BadRequestException('Only a draft booking billed in advance has a first invoice to send before it is confirmed');
    const [existing] = await this.db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.bookingId, bookingId), ne(invoices.status, 'VOID'))).limit(1);
    if (existing) throw new ConflictException('This booking already has its first invoice');
    const [period] = advancePeriods(b, colomboToday(now));
    if (!period) throw new BadRequestException('This booking has no dates left to bill');
    const preview = await this.invoicesService.previewBooking(bookingId, period.periodStart, period.periodEnd, 'SCHEDULED');
    if (preview.lines === 0) throw new BadRequestException('Add at least one shift before sending the invoice');
    if (preview.unpriced > 0) throw new BadRequestException('Set the client rate before sending the invoice');
    const who = { userId: actor.userId, email: actor.email, role: actor.role };
    const draft = await this.invoicesService.create({ bookingId, basis: 'SCHEDULED', periodStart: period.periodStart, periodEnd: period.periodEnd }, who);
    return this.invoicesService.issue(draft.id, {}, who);
  }

  /** An invoice was paid in full. If a draft booking was waiting for it: staff hear it can be confirmed, and the booking agent is asked to look. */
  async onPaid(invoiceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ number: invoices.number, bookingId: bookings.id, reference: bookings.reference, status: bookings.status, timing: bookings.billingTiming })
      .from(invoices)
      .innerJoin(bookings, eq(bookings.id, invoices.bookingId))
      .where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'PAID')))
      .limit(1);
    if (!row || row.status !== 'DRAFT' || row.timing !== 'ADVANCE') return false;
    // Only the booking's first invoice holds it.
    const [first] = await this.db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.bookingId, row.bookingId), ne(invoices.status, 'VOID'))).orderBy(asc(invoices.createdAt)).limit(1);
    if (first?.id !== invoiceId) return false;

    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: row.bookingId },
      { done: `Invoice ${row.number} is paid`, waiting: 'The booking to be confirmed', next: 'Confirm the booking - it is no longer waiting for payment' },
    );
    await nudgeBookingConfirm(this.jobs, this.automation, row.bookingId);
    await this.tellStaff(`Paid, ready to confirm: ${row.reference}`, [`Invoice ${row.number} for booking ${row.reference} has been paid in full.`, 'The booking was waiting for this payment and can now be confirmed.'], row.bookingId, `advance paid ${invoiceId}`);
    return true;
  }

  /**
   * Drafts still waiting for their first payment that now need a person: the
   * invoice is past its due date, or the booking starts within two days.
   * Staff are emailed once per booking, and the booking's history says so.
   */
  async alertUnpaid(now = new Date(), only?: string[]): Promise<number> {
    const today = colomboToday(now);
    const rows = await this.db
      .select({ bookingId: bookings.id, reference: bookings.reference, startDate: bookings.startDate, invoiceId: invoices.id, number: invoices.number, dueDate: invoices.dueDate, createdAt: invoices.createdAt })
      .from(bookings)
      .innerJoin(invoices, and(eq(invoices.bookingId, bookings.id), eq(invoices.status, 'ISSUED')))
      .where(and(eq(bookings.status, 'DRAFT'), eq(bookings.billingTiming, 'ADVANCE'), only ? inArray(bookings.id, only.length ? only : ['']) : undefined))
      .orderBy(asc(invoices.createdAt))
      .limit(500);
    let alerted = 0;
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.bookingId)) continue; // the first invoice only
      seen.add(r.bookingId);
      const overdue = !!r.dueDate && r.dueDate < today;
      const startsSoon = r.startDate <= addDays(today, UNPAID_ALERT_DAYS_BEFORE_START);
      if (!overdue && !startsSoon) continue;
      const [done] = await this.db.select({ id: bookingEvents.id }).from(bookingEvents).where(and(eq(bookingEvents.bookingId, r.bookingId), like(bookingEvents.note, `${ALERTED}%`))).limit(1);
      if (done) continue;
      const why = overdue ? `invoice ${r.number} was due on ${r.dueDate}` : `the booking starts on ${r.startDate}`;
      await this.db.insert(bookingEvents).values({ id: uuid(), bookingId: r.bookingId, type: 'NOTE', note: `${ALERTED} (${why})`, actorUserId: null });
      await this.tellStaff(
        `Not paid, not confirmed: ${r.reference}`,
        [
          `Booking ${r.reference} is billed in advance and is waiting for invoice ${r.number} to be paid: ${why}.`,
          'It has not been confirmed, so no caregiver is booked. Phone the client, or confirm the booking without payment if you have agreed that with them.',
        ],
        r.bookingId,
        `advance unpaid ${r.invoiceId}`,
      );
      alerted++;
    }
    return alerted;
  }

  private async tellStaff(subject: string, paragraphs: string[], bookingId: string, label: string) {
    const to = await this.staffRecipients();
    if (!to.length) return void this.logger.warn(`${subject} - but there is nobody to email`);
    const base = (this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '');
    await this.email.sendNotificationEmail(to, { subject, blocks: [{ lang: 'en', heading: subject, paragraphs }], cta: { label: 'Open the booking', url: `${base}/bookings/${bookingId}` } }, label);
  }

  /** The configured alert list, or else every active admin and staff account with an email address. */
  private async staffRecipients(): Promise<string[]> {
    const settings = await this.emailSettings.getResolved();
    if (settings.requestAlertsTo) {
      return settings.requestAlertsTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    }
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true)));
    return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
  }
}
