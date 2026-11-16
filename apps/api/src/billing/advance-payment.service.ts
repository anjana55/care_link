import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gt, inArray, isNotNull, isNull, like, lt, ne, or } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { UNPAID_ALERT_DAYS_BEFORE_START, addDays, advancePeriods, colomboToday, type PayableInvoice } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingEvents, bookingShifts, bookings, caregivers, invoices, patients, users } from '../database/schema';
import { BookingsService } from '../bookings/bookings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingSettingsService } from './billing-settings.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { nudgeBookingConfirm } from '../bookings/booking-agent-jobs';
import { InvoicesService } from './invoices.service';
import { INVOICE_PAID_JOB, UNPAID_SWEEP_JOB } from './advance-payment-jobs';

const HOUR_MS = 60 * 60 * 1000;
/** What the client, and the caregivers on the booking, are told when visits pause and resume. Caregivers are not told why. */
const PAUSED_CLIENT = {
  en: { title: 'Your visits are paused', body: 'Invoice {number} is past its due date. Your visits resume as soon as it is paid - you can pay it now.' },
  si: { title: 'ඔබගේ හමුවීම් තාවකාලිකව නවතා ඇත', body: '{number} ඉන්වොයිසිය ගෙවිය යුතු දිනය ඉක්මවා ඇත. එය ගෙවූ වහාම ඔබගේ හමුවීම් නැවත ආරම්භ වේ - ඔබට දැන් එය ගෙවිය හැක.' },
  ta: { title: 'உங்கள் வருகைகள் இடைநிறுத்தப்பட்டுள்ளன', body: 'விலைப்பட்டியல் {number} செலுத்த வேண்டிய நாளைக் கடந்துவிட்டது. அது செலுத்தப்பட்டவுடன் உங்கள் வருகைகள் மீண்டும் தொடங்கும் - இப்போதே செலுத்தலாம்.' },
} as const;
const RESUMED_CLIENT = {
  en: { title: 'Your visits go ahead again', body: 'Thank you. Your caregiver will come as booked.' },
  si: { title: 'ඔබගේ හමුවීම් නැවත ආරම්භ වේ', body: 'ස්තූතියි. ඔබගේ සත්කාරකයා වෙන්කළ පරිදි පැමිණේ.' },
  ta: { title: 'உங்கள் வருகைகள் மீண்டும் தொடர்கின்றன', body: 'நன்றி. உங்கள் பராமரிப்பாளர் முன்பதிவின்படி வருவார்.' },
} as const;
const PAUSED_CAREGIVER = {
  en: { title: 'Visits paused', body: 'The office has paused the visits for booking {reference}. Do not go until you hear they are back on.' },
  si: { title: 'හමුවීම් නවතා ඇත', body: '{reference} වෙන්කිරීමේ හමුවීම් කාර්යාලය විසින් තාවකාලිකව නවතා ඇත. ඒවා නැවත ආරම්භ වූ බව දැනුම් දෙන තෙක් නොයන්න.' },
  ta: { title: 'வருகைகள் இடைநிறுத்தம்', body: 'முன்பதிவு {reference} க்கான வருகைகளை அலுவலகம் இடைநிறுத்தியுள்ளது. மீண்டும் தொடங்கியதாகத் தெரிவிக்கும் வரை செல்ல வேண்டாம்.' },
} as const;
const RESUMED_CAREGIVER = {
  en: { title: 'Visits back on', body: 'The visits for booking {reference} go ahead again as booked.' },
  si: { title: 'හමුවීම් නැවත ආරම්භ විය', body: '{reference} වෙන්කිරීමේ හමුවීම් වෙන්කළ පරිදි නැවත සිදු වේ.' },
  ta: { title: 'வருகைகள் மீண்டும் தொடக்கம்', body: 'முன்பதிவு {reference} க்கான வருகைகள் முன்பதிவின்படி மீண்டும் நடைபெறும்.' },
} as const;

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
    private readonly bookingsService: BookingsService,
    private readonly notices: NotificationsService,
    private readonly billingSettings: BillingSettingsService,
  ) {}

  onApplicationBootstrap() {
    this.jobs.register(INVOICE_PAID_JOB, async (payload) => {
      const invoiceId = (payload as { invoiceId?: unknown }).invoiceId;
      if (typeof invoiceId === 'string') await this.onPaid(invoiceId);
    });
    this.jobs.register(UNPAID_SWEEP_JOB, async () => {
      await this.alertUnpaid();
      await this.holdUnpaid();
    });
    this.bookingsService.registerPayable((ids) => this.payable(ids));
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

  /** What the client owes on these invoices, and whether they can pay it online here. */
  async payable(invoiceIds: string[]): Promise<Map<string, PayableInvoice>> {
    if (!invoiceIds.length) return new Map();
    const [rows, settings] = await Promise.all([
      this.db
        .select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, paid: invoices.amountPaid, dueDate: invoices.dueDate })
        .from(invoices)
        .where(inArray(invoices.id, invoiceIds)),
      this.billingSettings.getResolved(),
    ]);
    return new Map(
      rows.map((r) => {
        const balanceCents = Math.round(Number(r.total) * 100) - Math.round(Number(r.paid) * 100);
        return [
          r.id,
          { id: r.id, number: r.number, total: r.total, balance: (balanceCents / 100).toFixed(2), dueDate: r.dueDate, canPayOnline: r.status === 'ISSUED' && balanceCents > 0 && settings.payhereUsable },
        ];
      }),
    );
  }

  /**
   * Visits paused for payment. A confirmed booking billed in advance whose
   * month's invoice is past its due date and unpaid has its visits paused:
   * staff are emailed, the caregivers on its coming shifts are told not to
   * go (without being told why), and the client is told what to pay. An
   * invoice staff have waived (confirmed or resumed without payment) never
   * pauses visits. Returns how many bookings were paused.
   */
  async holdUnpaid(now = new Date(), only?: string[]): Promise<number> {
    const today = colomboToday(now);
    const rows = await this.db
      .select({ bookingId: bookings.id, reference: bookings.reference, patientUserId: patients.userId, waived: bookings.paymentHoldWaivedInvoiceId, invoiceId: invoices.id, number: invoices.number, dueDate: invoices.dueDate })
      .from(bookings)
      .innerJoin(patients, eq(patients.id, bookings.patientId))
      .innerJoin(invoices, and(eq(invoices.bookingId, bookings.id), eq(invoices.status, 'ISSUED'), isNotNull(invoices.dueDate), lt(invoices.dueDate, today)))
      .where(and(eq(bookings.status, 'CONFIRMED'), eq(bookings.billingTiming, 'ADVANCE'), isNull(bookings.paymentHoldInvoiceId), only ? inArray(bookings.id, only.length ? only : ['']) : undefined))
      .orderBy(asc(invoices.dueDate))
      .limit(500);
    let held = 0;
    const done = new Set<string>();
    for (const r of rows) {
      if (done.has(r.bookingId) || r.invoiceId === r.waived) continue;
      done.add(r.bookingId);
      const [set] = await this.db
        .update(bookings)
        .set({ paymentHoldInvoiceId: r.invoiceId, paymentHoldAt: now })
        .where(and(eq(bookings.id, r.bookingId), isNull(bookings.paymentHoldInvoiceId)));
      if (!(set as { affectedRows: number }).affectedRows) continue;
      await this.db.insert(bookingEvents).values({ id: uuid(), bookingId: r.bookingId, type: 'NOTE', note: `Visits paused: invoice ${r.number} was due on ${r.dueDate} and is not paid`, actorUserId: null });
      await this.automation.setHandoverNote(
        { caseType: 'BOOKING', caseId: r.bookingId },
        { done: `Visits paused: invoice ${r.number} was due on ${r.dueDate} and is not paid`, waiting: `The client to pay invoice ${r.number}`, next: 'Visits resume when it is paid, or when staff resume them' },
      );
      await this.tellCaregivers(r.bookingId, now, 'paused');
      this.notices.notify([r.patientUserId], (lang) => ({ title: PAUSED_CLIENT[lang].title, body: PAUSED_CLIENT[lang].body.replace('{number}', r.number ?? '') }), `/invoices/${r.invoiceId}`, `visits paused ${r.bookingId}`);
      await this.tellStaff(
        `Visits paused: ${r.reference}`,
        [
          `Booking ${r.reference} is billed in advance and invoice ${r.number} was due on ${r.dueDate}. It is not paid, so its visits are paused.`,
          'The caregivers on its coming shifts have been told not to go, and the client has been asked to pay. Visits resume when the invoice is paid, or when you resume them on the booking.',
        ],
        r.bookingId,
        `visits paused ${r.invoiceId}`,
      );
      held++;
    }
    return held;
  }

  /** Staff resume a paused booking's visits without payment. The invoice is then never a reason to pause it again. */
  async resume(bookingId: string, reason: string | undefined, actor: AuthenticatedUser) {
    if (!reason?.trim() || reason.trim().length < 3) throw new BadRequestException('Say why visits resume without payment');
    const [b] = await this.db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!b) throw new NotFoundException('Booking not found');
    if (!b.paymentHoldInvoiceId) throw new BadRequestException('Visits on this booking are not paused');
    await this.release(b, `Visits resumed without payment: ${reason.trim()}`, actor.userId, true);
    return this.bookingsService.findOne(bookingId);
  }

  /** Lifts a pause: the booking's visits go ahead again and everyone who was told is told. */
  private async release(b: { id: string; reference: string; patientId: string; paymentHoldInvoiceId: string | null }, note: string, actorUserId: string | null, waive: boolean) {
    const invoiceId = b.paymentHoldInvoiceId!;
    const [cleared] = await this.db
      .update(bookings)
      .set({ paymentHoldInvoiceId: null, paymentHoldAt: null, ...(waive ? { paymentHoldWaivedInvoiceId: invoiceId } : {}) })
      .where(and(eq(bookings.id, b.id), eq(bookings.paymentHoldInvoiceId, invoiceId)));
    if (!(cleared as { affectedRows: number }).affectedRows) return false;
    await this.db.insert(bookingEvents).values({ id: uuid(), bookingId: b.id, type: 'NOTE', note, actorUserId });
    await this.automation.setHandoverNote({ caseType: 'BOOKING', caseId: b.id }, { done: note, waiting: 'Nothing', next: 'Visits go ahead as booked' });
    const now = new Date();
    await this.tellCaregivers(b.id, now, 'resumed');
    const [p] = await this.db.select({ userId: patients.userId }).from(patients).where(eq(patients.id, b.patientId)).limit(1);
    this.notices.notify([p?.userId ?? null], (lang) => RESUMED_CLIENT[lang], '/bookings', `visits resumed ${b.id}`);
    return true;
  }

  /** Bell and push to every caregiver with a coming shift on the booking. Nothing about the client's money: "the office has paused them". */
  private async tellCaregivers(bookingId: string, now: Date, what: 'paused' | 'resumed') {
    const rows = await this.db
      .selectDistinct({ userId: caregivers.userId })
      .from(bookingShifts)
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(and(eq(bookingShifts.bookingId, bookingId), eq(bookingShifts.status, 'SCHEDULED'), gt(bookingShifts.endsAt, now)));
    const [b] = await this.db.select({ reference: bookings.reference }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    const text = what === 'paused' ? PAUSED_CAREGIVER : RESUMED_CAREGIVER;
    this.notices.notify(rows.map((r) => r.userId), (lang) => ({ title: text[lang].title, body: text[lang].body.replace('{reference}', b?.reference ?? '') }), '/shifts', `visits ${what} ${bookingId}`);
  }

  /** An invoice was paid in full. A booking paused for it resumes; a draft waiting for it can be confirmed. */
  async onPaid(invoiceId: string): Promise<boolean> {
    const [paused] = await this.db.select().from(bookings).where(eq(bookings.paymentHoldInvoiceId, invoiceId)).limit(1);
    const [inv] = await this.db.select({ number: invoices.number, status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    if (paused && inv?.status === 'PAID' && (await this.release(paused, `Visits resumed: invoice ${inv.number} is paid`, null, false))) {
      await this.tellStaff(`Paid, visits resumed: ${paused.reference}`, [`Invoice ${inv.number} for booking ${paused.reference} has been paid in full.`, 'Its visits were paused for this payment and now go ahead again. The caregivers and the client have been told.'], paused.id, `visits resumed ${invoiceId}`);
      return true;
    }
    return this.onFirstPaid(invoiceId);
  }

  /** The first invoice of a draft billed in advance was paid: staff hear it can be confirmed, and the booking agent is asked to look. */
  private async onFirstPaid(invoiceId: string): Promise<boolean> {
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
