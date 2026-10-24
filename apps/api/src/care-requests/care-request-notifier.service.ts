import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { careRequestEvents, careRequests, caregivers, patients, users, type CareRequestLanguage, type CareRequestStatus } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { WhatsappSettingsService, type ResolvedWhatsappSettings } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import {
  CLIENT_CTA,
  CLIENT_FOOTER,
  caregiverNotice,
  caregiverNoticeFor,
  type CaregiverNotice,
  clientNotice,
  clientNoticeFor,
} from './notification-messages';

/** Everything a notice needs about one request, read fresh at send time. */
interface NoticeContext {
  id: string;
  reference: string;
  language: CareRequestLanguage;
  client: {
    email: string | null;
    phone: string | null; // E.164, best effort
    preferredContactMethod: 'PHONE_CALL' | 'WHATSAPP' | 'EMAIL' | null;
    careStart: string | null;
  };
  /** Null while no caregiver is attached (a phone request staff will match later). */
  caregiver: {
    email: string | null;
    phone: string | null; // E.164, best effort
    registrationNumber: string;
    autoNotify: boolean;
  } | null;
  careType: string | null;
  source: 'WEB' | 'PHONE';
}

/**
 * How a client hears about their request: their own preference first
 * (WhatsApp, if they chose it and updates can go out that way), otherwise
 * whichever channel they have, email before WhatsApp. PHONE_CALL as a
 * preference means staff call them - updates still need a written channel.
 */
export function chooseClientChannel(opts: {
  hasEmail: boolean;
  canWhatsapp: boolean;
  preferred: 'PHONE_CALL' | 'WHATSAPP' | 'EMAIL' | null;
}): 'EMAIL' | 'WHATSAPP' | null {
  if (opts.preferred === 'WHATSAPP' && opts.canWhatsapp) return 'WHATSAPP';
  if (opts.hasEmail) return 'EMAIL';
  if (opts.canWhatsapp) return 'WHATSAPP';
  return null;
}

/**
 * Tells the three parties to a care request what happened to it:
 *
 * - staff, by email, when a new request arrives (the Requests queue is the
 *   real worklist - this is the nudge to look at it);
 * - the client, by email or WhatsApp, when it is received and whenever staff
 *   move it on;
 * - the caregiver, by email or WhatsApp: as soon as the request arrives when
 *   they are set to auto-notify (otherwise when staff press "Notify
 *   caregiver"), and again when staff pick it up and make the introduction.
 *
 * Never throws and is never awaited by a request handler: a mail server being
 * down must not turn "send request" or "mark introduced" into an error, because
 * the request itself has already been saved. Failures are logged.
 *
 * Notices carry only the reference number and generic wording - no names,
 * phones or care details (see notification-messages.ts).
 */
@Injectable()
export class CareRequestNotifier {
  private readonly logger = new Logger(CareRequestNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  /**
   * A client just sent a request: alert staff, confirm to the client, and -
   * only if they are set to auto-notify - tell the caregiver they were asked for.
   */
  async requestCreated(requestId: string): Promise<void> {
    await this.safely('new request', async () => {
      const ctx = await this.load(requestId);
      if (!ctx) return;
      // A phone request was logged by staff themselves - no need to alert them.
      await Promise.all([
        ctx.source === 'WEB' ? this.alertStaff(ctx) : Promise.resolve(),
        this.notifyClient(ctx, 'RECEIVED'),
        ctx.caregiver?.autoNotify ? this.sendNewRequestAlert(ctx, null) : Promise.resolve(),
      ]);
    });
  }

  /** Staff attached a caregiver to an open request: auto-notify caregivers hear about it straight away. */
  async caregiverAttached(requestId: string): Promise<void> {
    await this.safely('caregiver attached', async () => {
      const ctx = await this.load(requestId);
      if (ctx?.caregiver?.autoNotify) await this.sendNewRequestAlert(ctx, null);
    });
  }

  /**
   * Staff pressed "Notify caregiver". Unlike every other notice this one is
   * awaited and reports back, so staff know whether it actually went.
   */
  async notifyCaregiverNow(requestId: string, actorUserId: string): Promise<'EMAIL' | 'WHATSAPP' | null> {
    const ctx = await this.load(requestId);
    if (!ctx?.caregiver) return null;
    try {
      return await this.sendNewRequestAlert(ctx, actorUserId);
    } catch (err) {
      this.logger.error(`Care request ${ctx.reference}: notifying the caregiver failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Sends the "you have a new request" notice and records that the caregiver has been told. */
  private async sendNewRequestAlert(ctx: NoticeContext, actorUserId: string | null): Promise<'EMAIL' | 'WHATSAPP' | null> {
    const channel = await this.notifyCaregiver(ctx, 'NEW');
    if (!channel) return null;
    const now = new Date();
    await this.db.update(careRequests).set({ caregiverNotifiedAt: now }).where(eq(careRequests.id, ctx.id));
    await this.db.insert(careRequestEvents).values({
      id: uuid(),
      requestId: ctx.id,
      type: 'CAREGIVER_NOTIFIED',
      note: `${ctx.caregiver!.registrationNumber} told by ${channel === 'EMAIL' ? 'email' : 'WhatsApp'}${actorUserId ? '' : ' (automatically)'}`,
      actorUserId,
    });
    return channel;
  }

  /** Staff moved a request into `status`. */
  async statusChanged(requestId: string, status: CareRequestStatus, opts: { caregiverOnly?: boolean } = {}): Promise<void> {
    await this.safely(`status change to ${status}`, async () => {
      const ctx = await this.load(requestId);
      if (!ctx) return;
      const forClient = opts.caregiverOnly ? null : clientNoticeFor(status);
      const forCaregiver = caregiverNoticeFor(status);
      await Promise.all([
        forClient ? this.notifyClient(ctx, forClient) : Promise.resolve(),
        forCaregiver && ctx.caregiver ? this.notifyCaregiver(ctx, forCaregiver).then((sent) => this.markCaregiverTold(ctx, sent)) : Promise.resolve(),
      ]);
    });
  }

  /** Any notice that reached the caregiver means they know about the request. */
  private async markCaregiverTold(ctx: NoticeContext, sent: 'EMAIL' | 'WHATSAPP' | null) {
    if (sent) await this.db.update(careRequests).set({ caregiverNotifiedAt: new Date() }).where(eq(careRequests.id, ctx.id));
  }

  private async safely(label: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (err) {
      this.logger.error(`Care request notification (${label}) failed: ${(err as Error).message}`);
    }
  }

  private async load(requestId: string): Promise<NoticeContext | null> {
    const [row] = await this.db
      .select({
        id: careRequests.id,
        reference: careRequests.reference,
        language: careRequests.language,
        source: careRequests.source,
        careType: careRequests.careType,
        patientUserId: patients.userId,
        patientPhone: patients.phone,
        preferredContactMethod: patients.preferredContactMethod,
        careStart: patients.careStart,
        caregiverUserId: caregivers.userId,
        caregiverPhone: caregivers.primaryPhone,
        registrationNumber: caregivers.registrationNumber,
        autoNotify: caregivers.autoNotifyRequests,
      })
      .from(careRequests)
      .innerJoin(patients, eq(careRequests.patientId, patients.id))
      .leftJoin(caregivers, eq(careRequests.caregiverId, caregivers.id))
      .where(eq(careRequests.id, requestId))
      .limit(1);
    if (!row) return null;

    const userIds = [row.patientUserId, row.caregiverUserId].filter((v): v is string => Boolean(v));
    const accounts = userIds.length
      ? await this.db.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, userIds))
      : [];
    const account = (id: string | null) => accounts.find((a) => a.id === id);
    const cc = await this.whatsappSettings.getDefaultCountryCode();

    const clientAccount = account(row.patientUserId);
    const caregiverAccount = account(row.caregiverUserId);
    return {
      id: row.id,
      reference: row.reference,
      language: row.language,
      client: {
        email: clientAccount?.email ?? null,
        // users.phone is the verified WhatsApp identity, already E.164; the
        // profile phone is free text and is normalised as a fallback.
        phone: clientAccount?.phone ?? normalizePhone(row.patientPhone, cc),
        preferredContactMethod: row.preferredContactMethod,
        careStart: row.careStart,
      },
      caregiver: row.registrationNumber
        ? {
            email: caregiverAccount?.email ?? null,
            phone: caregiverAccount?.phone ?? normalizePhone(row.caregiverPhone, cc),
            registrationNumber: row.registrationNumber,
            autoNotify: Boolean(row.autoNotify),
          }
        : null,
      careType: row.careType,
      source: row.source,
    };
  }

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  private staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }

  /**
   * The configured alert list, or else every active admin and staff account
   * with an email address. Read at send time so a settings change applies to
   * the next request.
   */
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

  private async alertStaff(ctx: NoticeContext) {
    const to = await this.staffRecipients();
    if (!to.length) {
      this.logger.warn(`New care request ${ctx.reference}: no staff email address to alert - it is waiting in the Requests queue.`);
      return;
    }
    const start = ctx.client.careStart ? ` Care needed: ${ctx.client.careStart.replace(/_/g, ' ').toLowerCase()}.` : '';
    const kind = ctx.careType ? ` Type of care: ${ctx.careType.replace(/_/g, ' ').toLowerCase()}.` : '';
    const ask = ctx.caregiver
      ? `A client has asked to be put in touch with caregiver ${ctx.caregiver.registrationNumber}.`
      : 'A client has asked us to find a caregiver for them - no caregiver is chosen yet.';
    const caregiverLine = ctx.caregiver
      ? ctx.caregiver.autoNotify
        ? 'The caregiver is set to auto-notify and has been told.'
        : 'The caregiver has not been told yet - use "Notify caregiver" on the request when you are ready.'
      : 'Match a caregiver on the request.';
    await this.email.sendNotificationEmail(
      to,
      {
        subject: `New care request ${ctx.reference}`,
        blocks: [
          {
            lang: 'en',
            heading: `New care request ${ctx.reference}`,
            paragraphs: [
              `${ask}${kind}${start}`,
              caregiverLine,
              'Open the request in the staff portal to see the client and caregiver details and pick it up.',
            ],
          },
        ],
        cta: { label: 'Open request', url: this.staffUrl(`/requests/${ctx.id}`) },
        footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
      },
      'care request alert',
    );
  }

  private async notifyClient(ctx: NoticeContext, notice: Parameters<typeof clientNotice>[0]) {
    const lang = ctx.language;
    const text = clientNotice(notice, lang, ctx.reference);
    const wa = await this.whatsappSettings.getResolved();
    const channel = chooseClientChannel({
      hasEmail: Boolean(ctx.client.email),
      canWhatsapp: Boolean(ctx.client.phone) && this.whatsapp.canSendUpdates(wa),
      preferred: ctx.client.preferredContactMethod,
    });
    if (channel === 'WHATSAPP') {
      await this.sendWhatsapp(wa, ctx.client.phone!, lang, `${text.heading}. ${text.body}`, `client update ${ctx.reference}`);
      return;
    }
    if (channel === 'EMAIL') {
      await this.email.sendNotificationEmail(
        ctx.client.email!,
        {
          subject: text.subject,
          blocks: [{ lang, heading: text.heading, paragraphs: [text.body] }],
          cta: { label: CLIENT_CTA[lang], url: this.publicUrl('/account/requests') },
          footer: CLIENT_FOOTER[lang],
        },
        `client update ${ctx.reference}`,
      );
      return;
    }
    this.logger.warn(`Care request ${ctx.reference}: the client has no email and WhatsApp updates are off, so "${notice}" was not sent.`);
  }

  /** Returns the channel the notice went out on, or null when it could not be sent. */
  private async notifyCaregiver(ctx: NoticeContext, notice: CaregiverNotice): Promise<'EMAIL' | 'WHATSAPP' | null> {
    const caregiver = ctx.caregiver;
    if (!caregiver) return null;
    const msg = caregiverNotice(notice, ctx.reference);
    if (caregiver.email) {
      await this.email.sendNotificationEmail(
        caregiver.email,
        {
          subject: msg.subject,
          blocks: msg.blocks.map((b) => ({ lang: b.lang, heading: b.heading, paragraphs: [b.body] })),
          cta: { label: '{brand}', url: this.publicUrl('/caregiver/dashboard') },
        },
        `caregiver update ${ctx.reference}`,
      );
      return 'EMAIL';
    }
    const wa = await this.whatsappSettings.getResolved();
    if (caregiver.phone && this.whatsapp.canSendUpdates(wa)) {
      return (await this.sendWhatsapp(wa, caregiver.phone, 'en', msg.whatsappText, `caregiver update ${ctx.reference}`)) ? 'WHATSAPP' : null;
    }
    this.logger.warn(`Care request ${ctx.reference}: the caregiver has no email and WhatsApp updates are off, so "${notice}" was not sent.`);
    return null;
  }

  private async sendWhatsapp(s: ResolvedWhatsappSettings, phone: string, lang: CareRequestLanguage, text: string, label: string): Promise<boolean> {
    try {
      await this.whatsapp.sendUpdate(s, phone, lang, text);
      return true;
    } catch (err) {
      this.logger.error(`WhatsApp ${label} failed: ${(err as Error).message}`);
      return false;
    }
  }
}
