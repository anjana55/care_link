import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  addDays,
  colomboToUtc,
  colomboToday,
  formatLkr,
  inQuietHours,
  toCents,
  toColombo,
  type NotificationSettings,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, caregiverDocuments, caregivers, deviceTokens, invoices, patients, reminderSends, users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import { TodosService, daysBetween } from './todos.service';
import { OPEN_CTA, digestNotice, type Lang, type ReminderKind, type ReminderLine } from './notification-messages';

const TICK_MS = 60 * 60_000;
/** A rejected document is chased once, this many days after it was rejected... */
const REJECTED_REMINDER_AFTER_DAYS = 3;
/** ...if it was rejected within this many days (older ones are left to staff). */
const REJECTED_LOOKBACK_DAYS = 30;
/** Staff hear about an unpaid invoice this many days past its due date. */
const OVERDUE_STAFF_DAYS = 7;
/** These reminders also go by the person's usual channel (WhatsApp or email); the rest are push and bell only. */
const USUAL_CHANNEL: ReadonlySet<ReminderKind> = new Set(['INVOICE_DUE', 'DOCUMENT_REJECTED']);
/** Logged once per message sent, so the daily cap counts messages rather than items. */
const MESSAGE_STAGE = 'MESSAGE';
const STAFF = 'staff';

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; errno?: number; cause?: { code?: string; errno?: number } };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062 || e?.cause?.code === 'ER_DUP_ENTRY' || e?.cause?.errno === 1062;
};

export interface Candidate {
  userId: string;
  line: ReminderLine;
  stage: string;
}

/** Groups candidates by person, oldest-first order kept. */
export function byPerson(candidates: Candidate[]): Map<string, Candidate[]> {
  const out = new Map<string, Candidate[]>();
  for (const c of candidates) out.set(c.userId, [...(out.get(c.userId) ?? []), c]);
  return out;
}

/**
 * Reminders, by one set of rules (Settings > Notifications):
 *
 * - Everything waiting on someone is always on their To do list; reminders
 *   are the nudge on top, sent once per item and stage (`reminder_sends`).
 * - Never in quiet hours (21:00-07:00 by default).
 * - At most `dailyReminderCap` messages a person a day; reminders due at the
 *   same time go as one digest.
 * - WhatsApp or email only for money and document problems; a shift today is
 *   a push. Push and the bell for everyone.
 * - Past that, staff are told, not the person: unpaid invoices a week overdue.
 *
 * The rating asks and the 8 pm care reminder keep their own sweeps (reviews,
 * care plans); document expiry keeps the Work abroad sweep. Old notifications
 * are deleted here once a day.
 */
@Injectable()
export class ReminderSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReminderSweepService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private lastHousekeepingDay: string | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly notices: NotificationsService,
    private readonly settings: NotificationSettingsService,
    private readonly todos: TodosService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('REMINDERS_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((err) => this.logger.warn(`Reminder sweep failed: ${(err as Error).message}`));
    const first = setTimeout(tick, 90_000);
    const every = setInterval(tick, TICK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(now = new Date()): Promise<{ messages: number; staff: number; deleted: number }> {
    if (this.running) return { messages: 0, staff: 0, deleted: 0 };
    this.running = true;
    try {
      const s = await this.settings.getResolved();
      const deleted = await this.housekeeping(s, now);
      const hour = Number(toColombo(now).time.slice(0, 2));
      if (!s.remindersEnabled || inQuietHours(hour, s)) return { messages: 0, staff: 0, deleted };
      const candidates = [...(await this.invoicesDueTomorrow(now)), ...(await this.rejectedDocuments(now)), ...(await this.shiftsToday(now))];
      let messages = 0;
      for (const [userId, items] of byPerson(candidates)) if (await this.remind(userId, items, s, now)) messages++;
      const staff = await this.overdueInvoicesToStaff(now);
      if (messages || staff) this.logger.log(`Reminders: ${messages} message(s) to people, ${staff} overdue invoice(s) to staff`);
      return { messages, staff, deleted };
    } finally {
      this.running = false;
    }
  }

  private async housekeeping(s: NotificationSettings, now: Date): Promise<number> {
    const today = colomboToday(now);
    if (this.lastHousekeepingDay === today) return 0;
    this.lastHousekeepingDay = today;
    const deleted = await this.notices.deleteOlderThan(s.retentionDays, now);
    // The lock only needs to outlive the thing it is about.
    await this.db.delete(reminderSends).where(lt(reminderSends.sentAt, new Date(now.getTime() - 400 * 86_400_000)));
    if (deleted) this.logger.log(`Notifications: deleted ${deleted} older than ${s.retentionDays} days`);
    return deleted;
  }

  // --- what is due -----------------------------------------------------------------

  /** Issued, unpaid invoices due tomorrow (Colombo). */
  async invoicesDueTomorrow(now = new Date()): Promise<Candidate[]> {
    const tomorrow = addDays(colomboToday(now), 1);
    const rows = await this.db
      .select({ id: invoices.id, number: invoices.number, total: invoices.total, amountPaid: invoices.amountPaid, dueDate: invoices.dueDate, userId: patients.userId })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .where(and(eq(invoices.status, 'ISSUED'), eq(invoices.dueDate, tomorrow), isNotNull(patients.userId)))
      .limit(2000);
    return rows
      .map((r) => ({ ...r, owed: toCents(r.total) - toCents(r.amountPaid) }))
      .filter((r) => r.owed > 0 && r.userId)
      .map((r) => ({
        userId: r.userId!,
        stage: 'DUE_SOON',
        line: {
          kind: 'INVOICE_DUE' as const,
          todo: { key: `invoice:${r.id}`, kind: 'PAY_INVOICE', path: `/invoices/${r.id}`, urgent: false, dueOn: r.dueDate, params: { number: r.number ?? '', amount: formatLkr(r.owed / 100), overdue: 0 } },
        },
      }));
  }

  /** Caregivers whose core document was rejected a few days ago and still haven't uploaded a new one. */
  async rejectedDocuments(now = new Date()): Promise<Candidate[]> {
    const rows = await this.db
      .selectDistinct({ caregiverId: caregiverDocuments.caregiverId, userId: caregivers.userId })
      .from(caregiverDocuments)
      .innerJoin(caregivers, eq(caregivers.id, caregiverDocuments.caregiverId))
      .where(
        and(
          eq(caregiverDocuments.verificationStatus, 'REJECTED'),
          lte(caregiverDocuments.verifiedAt, new Date(now.getTime() - REJECTED_REMINDER_AFTER_DAYS * 86_400_000)),
          gte(caregiverDocuments.verifiedAt, new Date(now.getTime() - REJECTED_LOOKBACK_DAYS * 86_400_000)),
          isNull(caregivers.deletedAt),
          isNotNull(caregivers.userId),
        ),
      )
      .limit(2000);
    const out: Candidate[] = [];
    for (const r of rows) {
      const todos = (await this.todos.documents(r.caregiverId, now)).filter((t) => t.kind === 'DOCUMENT_REJECTED');
      for (const todo of todos) out.push({ userId: r.userId!, stage: 'REMINDER', line: { kind: 'DOCUMENT_REJECTED', todo } });
    }
    return out;
  }

  /** Caregivers with a shift starting later today: one morning push each. */
  async shiftsToday(now = new Date()): Promise<Candidate[]> {
    const today = colomboToday(now);
    const rows = await this.db
      .select({ id: bookingShifts.id, startsAt: bookingShifts.startsAt, reference: bookings.reference, userId: caregivers.userId })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(
        and(
          eq(bookingShifts.status, 'SCHEDULED'),
          eq(bookings.status, 'CONFIRMED'),
          gte(bookingShifts.startsAt, new Date(now.getTime() + 30 * 60_000)),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(today, 1), '00:00')),
          isNotNull(caregivers.userId),
          isNull(caregivers.deletedAt),
        ),
      )
      .orderBy(asc(bookingShifts.startsAt))
      .limit(5000);
    const first = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (r.userId && !first.has(r.userId)) first.set(r.userId, r);
    return [...first.values()].map((r) => ({
      userId: r.userId!,
      // One morning push a day, whichever shift it names.
      stage: `TODAY:${today}`,
      line: {
        kind: 'SHIFT_TODAY' as const,
        todo: { key: `shiftday:${today}`, kind: 'SHIFT_TODAY', path: '/shifts', urgent: true, dueOn: today, params: { time: toColombo(new Date(r.startsAt)).time, reference: r.reference } },
      },
    }));
  }

  // --- sending ---------------------------------------------------------------------

  private async messagesToday(userId: string, now: Date): Promise<number> {
    const start = colomboToUtc(colomboToday(now), '00:00');
    const [row] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(reminderSends)
      .where(and(eq(reminderSends.userId, userId), eq(reminderSends.stage, MESSAGE_STAGE), gte(reminderSends.sentAt, start)));
    return Number(row?.n ?? 0);
  }

  /** Writes the lock row; false when it was already there (sent before, or by another run). */
  private async lock(userId: string, itemKey: string, stage: string, now: Date): Promise<boolean> {
    try {
      await this.db.insert(reminderSends).values({ id: uuid(), userId, itemKey: itemKey.slice(0, 160), stage: stage.slice(0, 24), sentAt: now });
      return true;
    } catch (err) {
      if (isDuplicate(err)) return false;
      throw err;
    }
  }

  private async alreadySent(userId: string, items: Candidate[]): Promise<Set<string>> {
    const rows = await this.db
      .select({ itemKey: reminderSends.itemKey, stage: reminderSends.stage })
      .from(reminderSends)
      .where(and(eq(reminderSends.userId, userId), inArray(reminderSends.itemKey, [...new Set(items.map((i) => i.line.todo.key))])));
    return new Set(rows.map((r) => `${r.itemKey}|${r.stage}`));
  }

  /** One person: drop what was already sent, respect the cap, lock, then one message (a digest when several). */
  async remind(userId: string, items: Candidate[], s: NotificationSettings, now = new Date()): Promise<boolean> {
    try {
      const sent = await this.alreadySent(userId, items);
      const due = items.filter((i) => !sent.has(`${i.line.todo.key}|${i.stage.slice(0, 24)}`));
      if (!due.length) return false;
      if ((await this.messagesToday(userId, now)) >= s.dailyReminderCap) return false;
      const locked: Candidate[] = [];
      for (const c of due) if (await this.lock(userId, c.line.todo.key, c.stage, now)) locked.push(c);
      if (!locked.length) return false;
      await this.lock(userId, `message:${uuid()}`, MESSAGE_STAGE, now);

      const lines = locked.map((c) => c.line);
      const path = lines.length === 1 ? lines[0].todo.path : '/notifications';
      this.notices.notify([userId], (lang) => digestNotice(lines, lang), path, `reminder ${lines.map((l) => l.kind).join(',')}`, { category: 'REMINDER' });
      if (lines.some((l) => USUAL_CHANNEL.has(l.kind))) await this.usualChannel(userId, lines);
      return true;
    } catch (err) {
      this.logger.error(`Reminder failed: ${(err as Error).message}`);
      return false;
    }
  }

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  /** The person's WhatsApp or email, as their other notices go, in the language they use. */
  private async usualChannel(userId: string, lines: ReminderLine[]) {
    const [account] = await this.db.select({ email: users.email, phone: users.phone, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (!account) return;
    const client = account.role === 'PATIENT_GUARDIAN';
    const [person] = client
      ? await this.db.select({ id: patients.id, phone: patients.phone, preferred: patients.preferredContactMethod }).from(patients).where(eq(patients.userId, userId)).limit(1)
      : await this.db.select({ id: caregivers.id, phone: caregivers.primaryPhone, preferred: caregivers.preferredContactMethod }).from(caregivers).where(eq(caregivers.userId, userId)).limit(1);
    const lang = await this.languageOf(userId, client ? person?.id : undefined);
    const cc = await this.whatsappSettings.getDefaultCountryCode();
    const phone = account.phone ?? normalizePhone(person?.phone ?? null, cc);
    const wa = await this.whatsappSettings.getResolved();
    const channel = chooseClientChannel({
      hasEmail: Boolean(account.email),
      canWhatsapp: Boolean(phone) && this.whatsapp.canSendUpdates(wa),
      preferred: (person?.preferred ?? null) as Parameters<typeof chooseClientChannel>[0]['preferred'],
    });
    const text = digestNotice(lines, lang);
    const label = `reminder ${lines.map((l) => l.kind.toLowerCase()).join(',')}`;
    if (channel === 'WHATSAPP') {
      await this.whatsapp.sendUpdate(wa, phone!, lang, `${text.title}. ${text.lines.join(' ')} ${text.footer}`).catch((e) => this.logger.error(`WhatsApp ${label} failed: ${(e as Error).message}`));
    } else if (channel === 'EMAIL') {
      await this.email.sendNotificationEmail(
        account.email!,
        {
          subject: text.title,
          blocks: [{ lang, heading: text.title, paragraphs: [...text.lines, text.footer] }],
          cta: { label: OPEN_CTA[lang], url: this.publicUrl(client ? '/account/notifications' : '/caregiver/notifications') },
        },
        label,
      );
    }
  }

  /** The app's language on their newest phone; else a client's latest booking language; else English. */
  private async languageOf(userId: string, patientId?: string): Promise<Lang> {
    const [device] = await this.db
      .select({ locale: deviceTokens.locale })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)))
      .orderBy(desc(deviceTokens.lastSeenAt))
      .limit(1);
    if (device) return device.locale;
    if (patientId) {
      const [b] = await this.db.select({ language: bookings.language }).from(bookings).where(eq(bookings.patientId, patientId)).orderBy(desc(bookings.createdAt)).limit(1);
      if (b) return b.language;
    }
    return 'en';
  }

  // --- staff ------------------------------------------------------------------------

  /** Unpaid invoices exactly a week overdue: one email to staff listing them, once each. */
  async overdueInvoicesToStaff(now = new Date()): Promise<number> {
    const today = colomboToday(now);
    const due = addDays(today, -OVERDUE_STAFF_DAYS);
    const rows = await this.db
      .select({ id: invoices.id, number: invoices.number, total: invoices.total, amountPaid: invoices.amountPaid, dueDate: invoices.dueDate, billToName: invoices.billToName })
      .from(invoices)
      .where(and(eq(invoices.status, 'ISSUED'), lte(invoices.dueDate, due), gte(invoices.dueDate, addDays(due, -7))))
      .limit(500);
    const owing = rows.map((r) => ({ ...r, owed: toCents(r.total) - toCents(r.amountPaid) })).filter((r) => r.owed > 0);
    const fresh: typeof owing = [];
    for (const r of owing) if (await this.lock(STAFF, `invoice:${r.id}`, 'OVERDUE_7', now)) fresh.push(r);
    if (!fresh.length) return 0;
    const to = await this.staffRecipients();
    if (!to.length) {
      this.logger.warn(`${fresh.length} invoice(s) are a week overdue, but there is no staff email address to tell.`);
      return fresh.length;
    }
    await this.email.sendNotificationEmail(
      to,
      {
        subject: `${fresh.length} invoice${fresh.length === 1 ? ' is' : 's are'} a week overdue`,
        blocks: [
          {
            lang: 'en',
            heading: 'Invoices a week overdue',
            paragraphs: [
              'These invoices are unpaid a week after their due date. The client has had a reminder and still has them on their To do list; a call may help.',
              ...fresh.map((r) => `${r.number ?? 'Invoice'} - ${r.billToName ?? 'client'}: ${formatLkr(r.owed / 100)} owed, due ${r.dueDate} (${-daysBetween(today, r.dueDate!)} days ago)`),
            ],
          },
        ],
        cta: { label: 'Open invoices', url: `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}/invoices` },
        footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
      },
      'overdue invoices',
    );
    return fresh.length;
  }

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
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true), isNotNull(users.email)));
    return rows.map((r) => r.email!).filter(Boolean);
  }
}

