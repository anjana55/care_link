import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { LOW_RATING_MAX, type ReviewBadge } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookings, caregiverReviews, caregivers, patients, users, type CareRequestLanguage } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { CLIENT_FOOTER } from '../care-requests/notification-messages';
import { PushService, fromBlocks, fromNotice } from '../push/push.service';
import { IMPROVEMENT_LABELS_EN, praiseNotice, reviewAskNotice, reviewRejectedNotice, type ClientNotice } from './review-messages';
import { parseTags } from './review-rules';

/** The page a client rates from, on the website and (through app links) in the app. */
export const ratePath = (bookingId: string, caregiverPublicId: string) => `/account/bookings/${bookingId}/rate/${caregiverPublicId}`;

/**
 * Tells people about ratings. Same channels and rules as the booking notices:
 * never throws, never holds up the action that caused it. Clients get one
 * message in their language by their preferred channel, with a push to the app
 * as well; caregivers get all three languages; staff get an English email.
 */
@Injectable()
export class ReviewsNotifier {
  private readonly logger = new Logger(ReviewsNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly push: PushService,
  ) {}

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  private staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }

  /** Ask the client to rate (first ask or the one reminder). Resolves false when nothing could be sent. */
  async askClient(stage: 'ASK' | 'REMINDER', p: { patientId: string; bookingId: string; reference: string; language: CareRequestLanguage; caregiverPublicId: string }): Promise<boolean> {
    try {
      const path = ratePath(p.bookingId, p.caregiverPublicId);
      const text = reviewAskNotice(stage, p.language, p.reference);
      const who = await this.client(p.patientId);
      if (!who) return false;
      this.push.notify([who.userId], (lang) => fromNotice(reviewAskNotice(stage, lang, p.reference)), `/bookings/${p.bookingId}/rate/${p.caregiverPublicId}`, `review ${stage.toLowerCase()} ${p.reference}`);
      return await this.deliverToClient(who, p.language, text, path, `review ${stage.toLowerCase()} ${p.reference}`);
    } catch (err) {
      this.logger.error(`Review request failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Staff did not publish the written part of a review: tell the client why. */
  async commentRejected(reviewId: string) {
    try {
      const r = await this.review(reviewId);
      if (!r || r.commentStatus !== 'REJECTED' || !r.commentRejectReason) return;
      const who = await this.client(r.patientId);
      if (!who) return;
      const text = reviewRejectedNotice(r.language, r.reference, r.commentRejectReason);
      this.push.notify([who.userId], (lang) => fromNotice(reviewRejectedNotice(lang, r.reference, r.commentRejectReason!)), `/bookings/${r.bookingId}/rate/${r.caregiverPublicId}`, `review rejected ${r.reference}`);
      await this.deliverToClient(who, r.language, text, ratePath(r.bookingId, r.caregiverPublicId), `review rejected ${r.reference}`);
    } catch (err) {
      this.logger.error(`Review rejection notice failed: ${(err as Error).message}`);
    }
  }

  /** 4-5 stars with badges: tell the caregiver, to praise them. */
  async praise(caregiverId: string, stars: number, badges: readonly ReviewBadge[]) {
    try {
      if (!badges.length) return;
      const msg = praiseNotice(stars, badges);
      const [c] = await this.db
        .select({ userId: caregivers.userId, phone: caregivers.primaryPhone, preferred: caregivers.preferredContactMethod })
        .from(caregivers)
        .where(eq(caregivers.id, caregiverId))
        .limit(1);
      if (!c) return;
      this.push.notify([c.userId], (lang) => fromBlocks(msg.pushBlocks, lang), '/me/ratings', 'caregiver praise');
      const [account] = c.userId ? await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, c.userId)).limit(1) : [];
      const cc = await this.whatsappSettings.getDefaultCountryCode();
      const phone = account?.phone ?? normalizePhone(c.phone ?? null, cc);
      const wa = await this.whatsappSettings.getResolved();
      const channel = chooseClientChannel({
        hasEmail: Boolean(account?.email),
        canWhatsapp: Boolean(phone) && this.whatsapp.canSendUpdates(wa),
        preferred: c.preferred as Parameters<typeof chooseClientChannel>[0]['preferred'],
      });
      if (channel === 'EMAIL') {
        await this.email.sendNotificationEmail(account!.email!, { subject: msg.subject, blocks: msg.blocks, cta: { label: '{brand}', url: this.publicUrl('/caregiver/ratings') } }, 'caregiver praise');
      } else if (channel === 'WHATSAPP') {
        await this.whatsapp.sendUpdate(wa, phone!, 'en', msg.whatsappText).catch((e) => this.logger.error(`WhatsApp caregiver praise failed: ${(e as Error).message}`));
      }
    } catch (err) {
      this.logger.error(`Caregiver praise notice failed: ${(err as Error).message}`);
    }
  }

  /** 1-2 stars: an English email to the office, for a follow-up call. */
  async lowRating(reviewId: string) {
    try {
      const r = await this.review(reviewId);
      if (!r || r.rating > LOW_RATING_MAX) return;
      const to = await this.staffRecipients();
      if (!to.length) {
        this.logger.warn(`Low rating on ${r.reference}: no staff email address to alert - it is waiting in Reviews.`);
        return;
      }
      const tags = parseTags(r.improvementTags).map((t) => IMPROVEMENT_LABELS_EN[t]);
      const paragraphs = [
        `The client gave ${r.caregiverName} ${r.rating} star${r.rating === 1 ? '' : 's'} on booking ${r.reference}.`,
        ...(tags.length ? [`Could be better: ${tags.join(', ')}.`] : []),
        ...(r.comment ? [`Their review: ${r.comment}`] : []),
        ...(r.privateNote ? [`Note to the office: ${r.privateNote}`] : []),
        'Please call the client to follow up.',
      ];
      await this.email.sendNotificationEmail(
        to,
        {
          subject: `Low rating on booking ${r.reference}`,
          blocks: [{ lang: 'en', heading: `Low rating on booking ${r.reference}`, paragraphs }],
          cta: { label: 'Open reviews', url: this.staffUrl('/reviews?filter=low') },
          footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
        },
        'low rating alert',
      );
    } catch (err) {
      this.logger.error(`Low rating alert failed: ${(err as Error).message}`);
    }
  }

  // --- lookups and delivery -------------------------------------------------------

  private async review(id: string) {
    const [r] = await this.db
      .select({
        id: caregiverReviews.id,
        bookingId: caregiverReviews.bookingId,
        patientId: caregiverReviews.patientId,
        rating: caregiverReviews.rating,
        improvementTags: caregiverReviews.improvementTags,
        comment: caregiverReviews.comment,
        commentStatus: caregiverReviews.commentStatus,
        commentRejectReason: caregiverReviews.commentRejectReason,
        privateNote: caregiverReviews.privateNote,
        reference: bookings.reference,
        language: bookings.language,
        caregiverName: caregivers.fullName,
        caregiverPublicId: caregivers.publicId,
      })
      .from(caregiverReviews)
      .innerJoin(bookings, eq(caregiverReviews.bookingId, bookings.id))
      .innerJoin(caregivers, eq(caregiverReviews.caregiverId, caregivers.id))
      .where(eq(caregiverReviews.id, id))
      .limit(1);
    return r ?? null;
  }

  private async client(patientId: string) {
    const [p] = await this.db
      .select({ userId: patients.userId, phone: patients.phone, preferred: patients.preferredContactMethod, email: users.email, accountPhone: users.phone, status: patients.status })
      .from(patients)
      .innerJoin(users, eq(patients.userId, users.id))
      .where(eq(patients.id, patientId))
      .limit(1);
    // A client whose account is closed (or being deleted) is not asked for anything.
    if (!p || p.status === 'INACTIVE') return null;
    const cc = await this.whatsappSettings.getDefaultCountryCode();
    return { userId: p.userId, email: p.email ?? null, phone: p.accountPhone ?? normalizePhone(p.phone ?? null, cc), preferred: p.preferred ?? null };
  }

  private async deliverToClient(
    who: { email: string | null; phone: string | null; preferred: string | null },
    lang: CareRequestLanguage,
    text: ClientNotice,
    path: string,
    label: string,
  ): Promise<boolean> {
    const wa = await this.whatsappSettings.getResolved();
    const channel = chooseClientChannel({
      hasEmail: Boolean(who.email),
      canWhatsapp: Boolean(who.phone) && this.whatsapp.canSendUpdates(wa),
      preferred: who.preferred as Parameters<typeof chooseClientChannel>[0]['preferred'],
    });
    if (channel === 'WHATSAPP') {
      await this.whatsapp.sendUpdate(wa, who.phone!, lang, `${text.heading}. ${text.body} ${this.publicUrl(path)}`).catch((e) => this.logger.error(`WhatsApp ${label} failed: ${(e as Error).message}`));
      return true;
    }
    if (channel === 'EMAIL') {
      await this.email.sendNotificationEmail(
        who.email!,
        { subject: text.subject, blocks: [{ lang, heading: text.heading, paragraphs: [text.body] }], cta: { label: text.cta, url: this.publicUrl(path) }, footer: CLIENT_FOOTER[lang] },
        label,
      );
      return true;
    }
    this.logger.warn(`${label}: the client has no email and WhatsApp updates are off, so the notice was not sent.`);
    return false;
  }

  /** The request alert list from Settings > Email, or every active admin and staff account. */
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
