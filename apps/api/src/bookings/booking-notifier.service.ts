import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { toColombo } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookings, bookingShifts, caregivers, patients, users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { CLIENT_CTA, CLIENT_FOOTER } from '../care-requests/notification-messages';
import { bookingCaregiverNotice, bookingClientNotice } from './booking-messages';

/**
 * Tells the client and the caregiver(s) when a booking is confirmed or
 * cancelled - the booked caregiver and anyone covering one of its shifts.
 * Same channels and rules as the request notices (CareRequestNotifier): never
 * throws, never delays the staff action, carries only the reference and date.
 */
@Injectable()
export class BookingNotifier {
  private readonly logger = new Logger(BookingNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  bookingConfirmed(id: string) {
    return this.send(id, 'CONFIRMED');
  }

  bookingCancelled(id: string) {
    return this.send(id, 'CANCELLED');
  }

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  private async send(id: string, notice: 'CONFIRMED' | 'CANCELLED') {
    try {
      const [b] = await this.db
        .select({
          reference: bookings.reference,
          language: bookings.language,
          startDate: bookings.startDate,
          caregiverId: bookings.caregiverId,
          patientUserId: patients.userId,
          patientPhone: patients.phone,
          preferred: patients.preferredContactMethod,
        })
        .from(bookings)
        .innerJoin(patients, eq(bookings.patientId, patients.id))
        .where(eq(bookings.id, id))
        .limit(1);
      if (!b) return;

      // The first shift that is going ahead gives the start date; a cancelled booking just quotes its start.
      const [first] = await this.db
        .select({ startsAt: bookingShifts.startsAt })
        .from(bookingShifts)
        .where(and(eq(bookingShifts.bookingId, id), ne(bookingShifts.status, 'CANCELLED')))
        .orderBy(asc(bookingShifts.startsAt))
        .limit(1);
      const date = first ? toColombo(first.startsAt).date : b.startDate;
      const vars = { ref: b.reference, date };

      const coverIds = (
        await this.db.selectDistinct({ caregiverId: bookingShifts.caregiverId }).from(bookingShifts).where(eq(bookingShifts.bookingId, id))
      ).map((r) => r.caregiverId);
      const caregiverIds = [...new Set([b.caregiverId, ...coverIds])];
      const cgs = await this.db
        .select({ id: caregivers.id, userId: caregivers.userId, phone: caregivers.primaryPhone })
        .from(caregivers)
        .where(inArray(caregivers.id, caregiverIds));
      const userIds = [b.patientUserId, ...cgs.map((c) => c.userId)].filter((v): v is string => Boolean(v));
      const accounts = await this.db.select({ id: users.id, email: users.email, phone: users.phone }).from(users).where(inArray(users.id, userIds));
      const account = (uid: string | null) => accounts.find((a) => a.id === uid);
      const wa = await this.whatsappSettings.getResolved();
      const cc = await this.whatsappSettings.getDefaultCountryCode();
      const canWa = (phone: string | null) => Boolean(phone) && this.whatsapp.canSendUpdates(wa);

      // Client.
      const clientEmail = account(b.patientUserId)?.email ?? null;
      const clientPhone = account(b.patientUserId)?.phone ?? normalizePhone(b.patientPhone, cc);
      const text = bookingClientNotice(notice, b.language, vars);
      const channel = chooseClientChannel({ hasEmail: Boolean(clientEmail), canWhatsapp: canWa(clientPhone), preferred: b.preferred });
      if (channel === 'WHATSAPP') {
        await this.whatsapp.sendUpdate(wa, clientPhone!, b.language, `${text.heading}. ${text.body}`).catch((e) => this.logger.error(`WhatsApp booking notice failed: ${(e as Error).message}`));
      } else if (channel === 'EMAIL') {
        await this.email.sendNotificationEmail(
          clientEmail!,
          {
            subject: text.subject,
            blocks: [{ lang: b.language, heading: text.heading, paragraphs: [text.body] }],
            cta: { label: CLIENT_CTA[b.language], url: this.publicUrl('/account/bookings') },
            footer: CLIENT_FOOTER[b.language],
          },
          `booking ${notice.toLowerCase()} ${b.reference}`,
        );
      } else {
        this.logger.warn(`Booking ${b.reference}: the client has no email and WhatsApp updates are off, so "${notice}" was not sent.`);
      }

      // Caregivers (booked and covering).
      const msg = bookingCaregiverNotice(notice, vars);
      for (const c of cgs) {
        const mail = account(c.userId)?.email ?? null;
        const phone = account(c.userId)?.phone ?? normalizePhone(c.phone, cc);
        if (mail) {
          await this.email.sendNotificationEmail(
            mail,
            {
              subject: msg.subject,
              blocks: msg.blocks.map((x) => ({ lang: x.lang, heading: x.heading, paragraphs: [x.body] })),
              cta: { label: 'CareLink', url: this.publicUrl('/caregiver/shifts') },
            },
            `caregiver booking ${notice.toLowerCase()} ${b.reference}`,
          );
        } else if (canWa(phone)) {
          await this.whatsapp.sendUpdate(wa, phone!, 'en', msg.whatsappText).catch((e) => this.logger.error(`WhatsApp booking notice failed: ${(e as Error).message}`));
        } else {
          this.logger.warn(`Booking ${b.reference}: a caregiver has no email and WhatsApp updates are off, so "${notice}" was not sent.`);
        }
      }
    } catch (err) {
      this.logger.error(`Booking notification (${notice}) failed: ${(err as Error).message}`);
    }
  }
}
