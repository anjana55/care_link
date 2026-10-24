import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { formatLkr } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, invoices, patients, payoutStatements, users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { BILLING_CTA, BILLING_FOOTER, invoiceClientNotice, payoutPaidNotice } from './billing-messages';

/**
 * Tells the client when an invoice is issued and when it is paid in full, and
 * the caregiver when their payout has been sent. Same channels and rules as
 * the booking notices: never throws, never delays the staff action.
 *
 * Every send returns whether a message actually went out, so "Send again" can
 * say so; callers that fire and forget simply ignore it.
 */
@Injectable()
export class BillingNotifier {
  private readonly logger = new Logger(BillingNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  invoiceIssued(id: string) {
    return this.toClient(id, 'ISSUED');
  }

  invoicePaid(id: string) {
    return this.toClient(id, 'PAID');
  }

  private async toClient(id: string, notice: 'ISSUED' | 'PAID'): Promise<boolean> {
    try {
      const [inv] = await this.db
        .select({
          number: invoices.number,
          total: invoices.total,
          dueDate: invoices.dueDate,
          language: invoices.language,
          billToEmail: invoices.billToEmail,
          patientUserId: patients.userId,
          patientPhone: patients.phone,
          preferred: patients.preferredContactMethod,
        })
        .from(invoices)
        .innerJoin(patients, eq(invoices.patientId, patients.id))
        .where(eq(invoices.id, id))
        .limit(1);
      if (!inv?.number) return false;
      const [account] = await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, inv.patientUserId)).limit(1);
      const wa = await this.whatsappSettings.getResolved();
      const cc = await this.whatsappSettings.getDefaultCountryCode();
      // The address on the invoice wins: staff may bill a family member's email.
      const mail = inv.billToEmail || account?.email || null;
      const phone = account?.phone ?? normalizePhone(inv.patientPhone, cc);
      const text = invoiceClientNotice(notice, inv.language, { number: inv.number, amount: formatLkr(inv.total), date: inv.dueDate ?? '' });
      const channel = chooseClientChannel({ hasEmail: Boolean(mail), canWhatsapp: Boolean(phone) && this.whatsapp.canSendUpdates(wa), preferred: inv.preferred });
      if (channel === 'WHATSAPP') {
        await this.whatsapp.sendUpdate(wa, phone!, inv.language, `${text.heading}. ${text.body}`);
        return true;
      }
      if (channel === 'EMAIL') {
        await this.email.sendNotificationEmail(
          mail!,
          {
            subject: text.subject,
            blocks: [{ lang: inv.language, heading: text.heading, paragraphs: [text.body] }],
            cta: { label: BILLING_CTA[inv.language], url: this.publicUrl(`/account/invoices/${id}`) },
            footer: BILLING_FOOTER[inv.language],
          },
          `invoice ${notice.toLowerCase()} ${inv.number}`,
        );
        return true;
      }
      this.logger.warn(`Invoice ${inv.number}: the client has no email and WhatsApp updates are off, so "${notice}" was not sent.`);
      return false;
    } catch (err) {
      this.logger.error(`Invoice notification (${notice}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  async payoutPaid(id: string): Promise<boolean> {
    try {
      const [p] = await this.db
        .select({
          reference: payoutStatements.reference,
          total: payoutStatements.total,
          periodStart: payoutStatements.periodStart,
          periodEnd: payoutStatements.periodEnd,
          paidOn: payoutStatements.paidOn,
          userId: caregivers.userId,
          phone: caregivers.primaryPhone,
          preferred: caregivers.preferredContactMethod,
        })
        .from(payoutStatements)
        .innerJoin(caregivers, eq(payoutStatements.caregiverId, caregivers.id))
        .where(eq(payoutStatements.id, id))
        .limit(1);
      if (!p) return false;
      const [account] = p.userId ? await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, p.userId)).limit(1) : [];
      const wa = await this.whatsappSettings.getResolved();
      const cc = await this.whatsappSettings.getDefaultCountryCode();
      const msg = payoutPaidNotice({ ref: p.reference, amount: formatLkr(p.total), from: p.periodStart, to: p.periodEnd, date: p.paidOn ?? '' });
      const phone = account?.phone ?? normalizePhone(p.phone, cc);
      const channel = chooseClientChannel({ hasEmail: Boolean(account?.email), canWhatsapp: Boolean(phone) && this.whatsapp.canSendUpdates(wa), preferred: p.preferred });
      if (channel === 'EMAIL') {
        await this.email.sendNotificationEmail(
          account!.email!,
          {
            subject: msg.subject,
            blocks: msg.blocks.map((b) => ({ lang: b.lang, heading: b.heading, paragraphs: [b.body] })),
            cta: { label: '{brand}', url: this.publicUrl('/caregiver/payments') },
          },
          `payout paid ${p.reference}`,
        );
        return true;
      }
      if (channel === 'WHATSAPP') {
        await this.whatsapp.sendUpdate(wa, phone!, 'en', msg.whatsappText);
        return true;
      }
      this.logger.warn(`Payout ${p.reference}: the caregiver has no email and WhatsApp updates are off, so the notice was not sent.`);
      return false;
    } catch (err) {
      this.logger.error(`Payout notification failed: ${(err as Error).message}`);
      return false;
    }
  }
}
