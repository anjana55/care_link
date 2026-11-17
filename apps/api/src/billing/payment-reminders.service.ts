import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  PAYMENT_REMINDER_DAYS_BEFORE,
  addDays,
  colomboToday,
  formatLkr,
  paymentReminderStage,
  type AgentRunResult,
  type PaymentReminderStage,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookings, invoiceReminders, invoices, patients, users } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { EmailService } from '../email/email.service';
import { normalizePhone } from '../common/utils/phone.util';

const ACTION = 'billing.remind_payment' as const;
type Lang = 'en' | 'si' | 'ta';

/** {number}, {amount}, {date}. The advance lines add what happens to visits. */
const TEXT: Record<PaymentReminderStage, Record<Lang, { title: string; body: string; advance?: string }>> = {
  BEFORE: {
    en: { title: 'Invoice {number} is due on {date}', body: '{amount} is due on {date}. You can pay it online from the invoice.', advance: 'Paying by then keeps your visits going.' },
    si: { title: '{number} ඉන්වොයිසිය {date} දින ගෙවිය යුතුය', body: '{amount} {date} දින ගෙවිය යුතුය. ඔබට ඉන්වොයිසියෙන් එය මාර්ගගතව ගෙවිය හැක.', advance: 'ඒ වන විට ගෙවීමෙන් ඔබගේ හමුවීම් දිගටම පවතී.' },
    ta: { title: 'விலைப்பட்டியல் {number} {date} அன்று செலுத்த வேண்டும்', body: '{amount} {date} அன்று செலுத்த வேண்டும். விலைப்பட்டியலில் இருந்து இணையத்தில் செலுத்தலாம்.', advance: 'அதற்குள் செலுத்தினால் உங்கள் வருகைகள் தொடரும்.' },
  },
  DUE: {
    en: { title: 'Invoice {number} is due today', body: '{amount} is due today. You can pay it online from the invoice.', advance: 'If it is not paid, visits pause from tomorrow until it is.' },
    si: { title: '{number} ඉන්වොයිසිය අද ගෙවිය යුතුය', body: '{amount} අද ගෙවිය යුතුය. ඔබට ඉන්වොයිසියෙන් එය මාර්ගගතව ගෙවිය හැක.', advance: 'එය නොගෙවුවහොත්, ගෙවන තුරු හෙට සිට හමුවීම් නවතී.' },
    ta: { title: 'விலைப்பட்டியல் {number} இன்று செலுத்த வேண்டும்', body: '{amount} இன்று செலுத்த வேண்டும். விலைப்பட்டியலில் இருந்து இணையத்தில் செலுத்தலாம்.', advance: 'செலுத்தப்படாவிட்டால், செலுத்தும் வரை நாளை முதல் வருகைகள் நிறுத்தப்படும்.' },
  },
  OVERDUE: {
    en: { title: 'Invoice {number} is overdue', body: '{amount} was due on {date}. Please pay it, or contact us if something is not right.' },
    si: { title: '{number} ඉන්වොයිසිය ගෙවීම ප්‍රමාදයි', body: '{amount} {date} දින ගෙවිය යුතුව තිබුණි. කරුණාකර එය ගෙවන්න, නැතහොත් යමක් වැරදි නම් අප අමතන්න.' },
    ta: { title: 'விலைப்பட்டியல் {number} தாமதமாகிவிட்டது', body: '{amount} {date} அன்று செலுத்த வேண்டியிருந்தது. தயவுசெய்து செலுத்துங்கள், அல்லது ஏதேனும் சரியில்லை என்றால் எங்களைத் தொடர்பு கொள்ளுங்கள்.' },
  },
};

export interface ReminderProposal extends Record<string, unknown> {
  invoiceId: string;
  number: string;
  stage: PaymentReminderStage;
}

/**
 * The billing agent's payment reminders: an issued, unpaid invoice gets a
 * nudge a few days before it is due, one on the day, and - for work billed
 * after it was done - one a few days late (a month billed in advance past
 * due pauses its visits instead, and that tells the client). Bell, push,
 * WhatsApp (unless the client prefers a phone call) and email when the
 * invoice has an address. In the invoice's language. Each stage once.
 *
 * Tier 1 (`billing.remind_payment`): done in Auto, proposed in Assist, only
 * logged in Shadow, nothing in Manual. Runs in the billing agent's hourly pass.
 */
@Injectable()
export class PaymentRemindersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentRemindersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly automation: AutomationService,
    private readonly notices: NotificationsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly email: EmailService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(ACTION, this.remind);
  }

  /** One pass. `only`: just these invoices. */
  async sweep(now = new Date(), only?: string[]): Promise<Pick<AgentRunResult, 'considered' | 'decided' | 'scored'>> {
    const out = { considered: 0, decided: 0, scored: 0 };
    if ((await this.automation.gate(ACTION)).mode === 'MANUAL') return out;
    out.scored = await this.scoreShadows(only);
    const today = colomboToday(now);
    const rows = await this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        timing: bookings.billingTiming,
      })
      .from(invoices)
      .leftJoin(bookings, eq(bookings.id, invoices.bookingId))
      .where(
        and(
          eq(invoices.status, 'ISSUED'),
          isNotNull(invoices.dueDate),
          sql`${invoices.total} > ${invoices.amountPaid}`,
          gte(invoices.dueDate, addDays(today, -30)),
          lte(invoices.dueDate, addDays(today, PAYMENT_REMINDER_DAYS_BEFORE)),
          only ? inArray(invoices.id, only.length ? only : ['-']) : undefined,
        ),
      )
      .limit(1000);
    if (!rows.length) return out;
    const sent = await this.db.select().from(invoiceReminders).where(inArray(invoiceReminders.invoiceId, rows.map((r) => r.id)));
    for (const r of rows) {
      const stage = paymentReminderStage(
        { issueDate: r.issueDate, dueDate: r.dueDate!, advance: r.timing === 'ADVANCE' },
        today,
        sent.filter((s) => s.invoiceId === r.id).map((s) => s.stage),
      );
      if (!stage) continue;
      out.considered++;
      const ref = { caseType: 'INVOICE' as const, caseId: r.id };
      if ((await this.automation.gate(ACTION, ref)).outcome === 'NONE') continue;
      const decision = await this.automation.decide({
        action: ACTION,
        case: ref,
        reason: stage === 'OVERDUE' ? `Remind the client: invoice ${r.number} was due on ${r.dueDate}` : stage === 'DUE' ? `Remind the client: invoice ${r.number} is due today` : `Remind the client: invoice ${r.number} is due on ${r.dueDate}`,
        proposal: { invoiceId: r.id, number: r.number ?? '', stage } satisfies ReminderProposal,
        dedupeKey: `${r.id}|${stage}`,
      });
      if (!decision.decisionId) continue;
      out.decided++;
      if (decision.outcome === 'EXECUTE') {
        const result = await this.automation.execute(decision.decisionId);
        if (!result.ok) this.logger.warn(`Payment reminder for ${r.number} not sent - ${result.error}`);
      }
    }
    return out;
  }

  private readonly remind: ActionExecutor = async (decision) => {
    const p = decision.proposal as ReminderProposal | null;
    if (!p?.invoiceId || !p.stage) throw new BadRequestException('This proposal has no invoice');
    const [inv] = await this.db
      .select({
        invoice: invoices,
        timing: bookings.billingTiming,
        userId: patients.userId,
        phone: patients.phone,
        preferred: patients.preferredContactMethod,
        accountPhone: users.phone,
      })
      .from(invoices)
      .innerJoin(patients, eq(patients.id, invoices.patientId))
      .leftJoin(users, eq(users.id, patients.userId))
      .leftJoin(bookings, eq(bookings.id, invoices.bookingId))
      .where(eq(invoices.id, p.invoiceId))
      .limit(1);
    // Paid, voided or changed since: say so rather than remind.
    if (!inv || inv.invoice.status !== 'ISSUED' || Number(inv.invoice.total) <= Number(inv.invoice.amountPaid)) throw new BadRequestException('This invoice is no longer waiting for payment');
    const [claimed] = await this.db.insert(invoiceReminders).values({ invoiceId: p.invoiceId, stage: p.stage, sentAt: new Date() }).onDuplicateKeyUpdate({ set: { invoiceId: sql`invoice_id` } });
    if ((claimed as { affectedRows: number }).affectedRows !== 1) throw new BadRequestException('This reminder has already been sent');

    const lang = (inv.invoice.language ?? 'en') as Lang;
    const advance = inv.timing === 'ADVANCE';
    const balance = formatLkr(Number(inv.invoice.total) - Number(inv.invoice.amountPaid));
    const words = (l: Lang) => {
      const t = TEXT[p.stage][l];
      const fill = (s: string) => s.replaceAll('{number}', inv.invoice.number ?? '').replaceAll('{amount}', balance).replaceAll('{date}', inv.invoice.dueDate ?? '');
      return { title: fill(t.title), body: fill(advance && t.advance ? `${t.body} ${t.advance}` : t.body) };
    };
    const told: string[] = [];
    this.notices.notify([inv.userId], (l) => words(l), `/invoices/${p.invoiceId}`, `payment reminder ${p.invoiceId} ${p.stage}`);
    told.push('bell');
    try {
      const wa = await this.whatsappSettings.getResolved();
      const phone = inv.accountPhone ?? normalizePhone(inv.phone, await this.whatsappSettings.getDefaultCountryCode());
      if (phone && inv.preferred !== 'PHONE_CALL' && this.whatsapp.canSendUpdates(wa)) {
        const w = words(lang);
        await this.whatsapp.sendUpdate(wa, phone, lang, `{brand}: ${w.title}. ${w.body}`);
        told.push('whatsapp');
      }
    } catch (err) {
      this.logger.warn(`Payment reminder WhatsApp for ${p.number} failed - ${(err as Error).message}`);
    }
    if (inv.invoice.billToEmail) {
      try {
        const w = words(lang);
        await this.email.sendNotificationEmail(inv.invoice.billToEmail, { subject: w.title, blocks: [{ lang, heading: w.title, paragraphs: [w.body] }] }, `payment reminder ${p.invoiceId} ${p.stage}`);
        told.push('email');
      } catch (err) {
        this.logger.warn(`Payment reminder email for ${p.number} failed - ${(err as Error).message}`);
      }
    }
    await this.automation.setHandoverNote(
      { caseType: 'INVOICE', caseId: p.invoiceId },
      { done: `Reminded the client (${told.join(', ')}): ${words('en').title}`, waiting: 'The client to pay', next: p.stage === 'OVERDUE' ? 'Staff to follow up if it stays unpaid' : 'Another reminder if it is still unpaid' },
    );
    return { told };
  };

  /** Shadow reminders are scored once the invoice is settled: paid = it was worth reminding; voided = it was not. */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select({ id: agentDecisions.id, caseId: agentDecisions.caseId })
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, ACTION), eq(agentDecisions.outcome, 'SHADOW'), sql`${agentDecisions.staffVerdict} IS NULL`, only ? inArray(agentDecisions.caseId, only.length ? only : ['-']) : undefined))
      .limit(500);
    if (!open.length) return 0;
    const states = await this.db.select({ id: invoices.id, status: invoices.status }).from(invoices).where(inArray(invoices.id, [...new Set(open.map((d) => d.caseId!))]));
    const agent = (await this.automation.agentActor('BILLING')).userId;
    let scored = 0;
    for (const d of open) {
      const status = states.find((s) => s.id === d.caseId)?.status;
      if (status !== 'PAID' && status !== 'VOID') continue;
      await this.automation.review(d.id, status === 'PAID' ? 'AGREED' : 'DIFFERED', status === 'PAID' ? 'Scored automatically: the invoice was owed' : 'Scored automatically: the invoice was voided', agent);
      scored++;
    }
    return scored;
  }
}
