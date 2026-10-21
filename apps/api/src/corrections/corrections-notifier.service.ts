import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { formatLkr, toCents } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingIssueReports, bookings, caregivers, patients, users, type CareRequestLanguage } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { BookingNotifier } from '../bookings/booking-notifier.service';
import { CATEGORY_EN, CORRECTION_CTA, correctionCaregiverNotice, correctionClientNotice, issueNotice } from './corrections-messages';

/** Who to tell about a committed correction - worked out inside its transaction, sent after it. */
export interface CorrectionNotices {
  bookingId: string;
  reference: string;
  language: CareRequestLanguage;
  patientId: string;
  client: { action: 'REPLACE' | 'CARRY'; label: string | null; amount: string }[];
  caregivers: { caregiverId: string; items: { action: 'REOPEN' | 'CARRY'; label: string | null; amount: string }[] }[];
  cancelled: boolean;
  issueIds: string[];
}

interface Recipient {
  email: string | null;
  phone: string | null;
  preferred?: string | null;
}

/**
 * Tells people about corrections and issue reports. Same channels and rules
 * as the booking and billing notices: never throws, never holds up the staff
 * action. Clients get one message in their language, by their preferred
 * channel; caregivers get all three languages, by email or else WhatsApp;
 * staff get an English email when a report arrives.
 */
@Injectable()
export class CorrectionsNotifier {
  private readonly logger = new Logger(CorrectionsNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly bookingNotifier: BookingNotifier,
  ) {}

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  private staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }

  // --- corrections ----------------------------------------------------------------

  async send(n: CorrectionNotices) {
    try {
      if (n.cancelled) await this.bookingNotifier.bookingCancelled(n.bookingId);
      if (n.client.length) await this.toClient(n);
      for (const cg of n.caregivers) if (cg.items.length) await this.toCaregiver(n.reference, cg);
      for (const id of n.issueIds) await this.issueClosed(id);
    } catch (err) {
      this.logger.error(`Correction notices for ${n.reference} failed: ${(err as Error).message}`);
    }
  }

  private async toClient(n: CorrectionNotices) {
    const items = n.client.map((c) => {
      const label = c.label ?? n.reference;
      if (c.action === 'REPLACE') return { kind: 'REPLACE' as const, label, amount: '' };
      const cents = toCents(c.amount);
      return { kind: cents < 0 ? ('CREDIT' as const) : ('OWE' as const), label, amount: formatLkr(Math.abs(cents) / 100) };
    });
    const text = correctionClientNotice(n.language, n.reference, items);
    const who = await this.client(n.patientId);
    await this.deliverToClient(who, n.language, text, '/account/invoices', `correction ${n.reference}`);
  }

  private async toCaregiver(reference: string, cg: CorrectionNotices['caregivers'][number]) {
    const items = cg.items.map((i) => {
      const label = i.label ?? reference;
      if (i.action === 'REOPEN') return { kind: 'REOPEN' as const, label, amount: '' };
      const cents = toCents(i.amount);
      return { kind: cents < 0 ? ('LESS' as const) : ('MORE' as const), label, amount: formatLkr(Math.abs(cents) / 100) };
    });
    const msg = correctionCaregiverNotice(reference, items);
    await this.deliverToCaregiver(await this.caregiver(cg.caregiverId), msg, '/caregiver/payments', `caregiver correction ${reference}`);
  }

  // --- issue reports -------------------------------------------------------------

  /** A report arrived: alert staff, and tell the reporter it is in hand. */
  async issueReported(id: string) {
    try {
      const r = await this.report(id);
      if (!r) return;
      const to = await this.staffRecipients();
      if (to.length) {
        await this.email.sendNotificationEmail(
          to,
          {
            subject: `Issue reported on booking ${r.reference}`,
            blocks: [
              {
                lang: 'en',
                heading: `Issue reported on booking ${r.reference}`,
                paragraphs: [`The ${r.reporterRole === 'CLIENT' ? 'client' : 'caregiver'} says: ${CATEGORY_EN[r.category]}.`, r.message, 'Open the booking to check it and correct it, or answer the report.'],
              },
            ],
            cta: { label: 'Open booking', url: this.staffUrl(`/bookings/${r.bookingId}`) },
            footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
          },
          'issue report alert',
        );
      } else {
        this.logger.warn(`Issue report on ${r.reference}: no staff email address to alert - it is waiting on the booking.`);
      }
      await this.toReporter(r, 'RECEIVED');
    } catch (err) {
      this.logger.error(`Issue report notice failed: ${(err as Error).message}`);
    }
  }

  /** A report was resolved or dismissed: tell the reporter, with staff's note. */
  async issueClosed(id: string) {
    try {
      const r = await this.report(id);
      if (!r || r.status === 'OPEN') return;
      await this.toReporter(r, r.status);
    } catch (err) {
      this.logger.error(`Issue report notice failed: ${(err as Error).message}`);
    }
  }

  private async toReporter(r: NonNullable<Awaited<ReturnType<CorrectionsNotifier['report']>>>, kind: 'RECEIVED' | 'RESOLVED' | 'DISMISSED') {
    const note = kind === 'RECEIVED' ? null : r.resolutionNote;
    if (r.reporterRole === 'CLIENT') {
      const text = issueNotice(kind, r.language, r.reference, note, false);
      const block = text.blocks[0];
      await this.deliverToClient(await this.client(r.patientId), r.language, { subject: text.subject, heading: block.heading, paragraphs: block.paragraphs }, '/account/bookings', `issue ${kind.toLowerCase()} ${r.reference}`);
    } else if (r.caregiverId) {
      await this.deliverToCaregiver(await this.caregiver(r.caregiverId), issueNotice(kind, 'en', r.reference, note, true), '/caregiver/shifts', `caregiver issue ${kind.toLowerCase()} ${r.reference}`);
    }
  }

  private async report(id: string) {
    const [r] = await this.db
      .select({
        id: bookingIssueReports.id,
        bookingId: bookingIssueReports.bookingId,
        reporterRole: bookingIssueReports.reporterRole,
        caregiverId: bookingIssueReports.caregiverId,
        category: bookingIssueReports.category,
        message: bookingIssueReports.message,
        language: bookingIssueReports.language,
        status: bookingIssueReports.status,
        resolutionNote: bookingIssueReports.resolutionNote,
        reference: bookings.reference,
        patientId: bookings.patientId,
      })
      .from(bookingIssueReports)
      .innerJoin(bookings, eq(bookingIssueReports.bookingId, bookings.id))
      .where(eq(bookingIssueReports.id, id))
      .limit(1);
    return r ?? null;
  }

  // --- delivery --------------------------------------------------------------------

  private async client(patientId: string): Promise<Recipient> {
    const [p] = await this.db
      .select({ phone: patients.phone, preferred: patients.preferredContactMethod, email: users.email, accountPhone: users.phone })
      .from(patients)
      .innerJoin(users, eq(patients.userId, users.id))
      .where(eq(patients.id, patientId))
      .limit(1);
    const cc = await this.whatsappSettings.getDefaultCountryCode();
    return { email: p?.email ?? null, phone: p?.accountPhone ?? normalizePhone(p?.phone ?? null, cc), preferred: p?.preferred ?? null };
  }

  private async caregiver(caregiverId: string): Promise<Recipient> {
    const [c] = await this.db.select({ userId: caregivers.userId, phone: caregivers.primaryPhone }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
    const [account] = c?.userId ? await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, c.userId)).limit(1) : [];
    const cc = await this.whatsappSettings.getDefaultCountryCode();
    return { email: account?.email ?? null, phone: account?.phone ?? normalizePhone(c?.phone ?? null, cc) };
  }

  private async deliverToClient(who: Recipient, lang: CareRequestLanguage, text: { subject: string; heading: string; paragraphs: string[] }, path: string, label: string) {
    const wa = await this.whatsappSettings.getResolved();
    const channel = chooseClientChannel({
      hasEmail: Boolean(who.email),
      canWhatsapp: Boolean(who.phone) && this.whatsapp.canSendUpdates(wa),
      preferred: who.preferred as Parameters<typeof chooseClientChannel>[0]['preferred'],
    });
    if (channel === 'WHATSAPP') {
      await this.whatsapp.sendUpdate(wa, who.phone!, lang, `${text.heading}. ${text.paragraphs.join(' ')}`).catch((e) => this.logger.error(`WhatsApp ${label} failed: ${(e as Error).message}`));
    } else if (channel === 'EMAIL') {
      await this.email.sendNotificationEmail(
        who.email!,
        { subject: text.subject, blocks: [{ lang, heading: text.heading, paragraphs: text.paragraphs }], cta: { label: CORRECTION_CTA[lang], url: this.publicUrl(path) } },
        label,
      );
    } else {
      this.logger.warn(`${label}: the client has no email and WhatsApp updates are off, so the notice was not sent.`);
    }
  }

  private async deliverToCaregiver(who: Recipient, msg: { subject: string; blocks: { lang: CareRequestLanguage; heading: string; paragraphs: string[] }[]; whatsappText: string }, path: string, label: string) {
    if (who.email) {
      await this.email.sendNotificationEmail(who.email, { subject: msg.subject, blocks: msg.blocks, cta: { label: '{brand}', url: this.publicUrl(path) } }, label);
      return;
    }
    const wa = await this.whatsappSettings.getResolved();
    if (who.phone && this.whatsapp.canSendUpdates(wa)) {
      await this.whatsapp.sendUpdate(wa, who.phone, 'en', msg.whatsappText).catch((e) => this.logger.error(`WhatsApp ${label} failed: ${(e as Error).message}`));
      return;
    }
    this.logger.warn(`${label}: the caregiver has no email and WhatsApp updates are off, so the notice was not sent.`);
  }

  /** The request alert list from Settings > Email, or every active admin and staff account (as for new care requests). */
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
