import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  MAX_OPEN_CARE_OFFERS,
  CARE_OFFER_MINUTES,
  effectiveCareOfferStatus,
  type CaregiverCareOffer,
  type LocalPlaceName,
  type CareOfferDeclineReason,
  type StaffCareOffer,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { OPEN_CARE_REQUEST_STATUSES, careRequests, caregivers, cities, districts, patients, requestOffers, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CareRequestsService } from '../care-requests/care-requests.service';
import { PricingService } from '../pricing/pricing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { JobsService } from '../jobs/jobs.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { nudgeMatching } from '../matching/matching-jobs';
import { nudgeBooking } from '../bookings/booking-agent-jobs';
import { AutomationService } from '../automation/automation.service';
import type { SendOfferDto } from './dto/offers.dto';

const EXPIRE_JOB = 'offers.expire';
const expiryKey = (offerId: string) => `offer-expiry:${offerId}`;

type OfferRow = typeof requestOffers.$inferSelect;

/** What the caregiver's phone and bell say, in their three languages. */
const NEW_OFFER = {
  en: { title: 'A new job offer', body: 'Open {brand} to see the details and answer before it runs out.' },
  si: { title: 'නව රැකියා යෝජනාවක්', body: 'විස්තර බලා, කාලය ඉකුත් වීමට පෙර පිළිතුරු දීමට {brand} විවෘත කරන්න.' },
  ta: { title: 'புதிய வேலை வாய்ப்பு', body: 'விவரங்களைப் பார்த்து, நேரம் முடிவதற்குள் பதிலளிக்க {brand} ஐத் திறக்கவும்.' },
} as const;
/** The line a WhatsApp message or email adds: until when, in Sri Lanka time. */
const NEW_OFFER_UNTIL = {
  en: 'Please answer by {until}.',
  si: '{until} ට පෙර පිළිතුරු දෙන්න.',
  ta: '{until} க்குள் பதிலளிக்கவும்.',
} as const;
/** "12 Nov, 15:51" in Sri Lanka, wherever the server runs. */
export function offerDeadline(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}
const OFFER_FILLED = {
  en: { title: 'A job offer is no longer open', body: 'Someone else took it, or the office withdrew it. Nothing is needed from you.' },
  si: { title: 'රැකියා යෝජනාවක් තවදුරටත් විවෘත නැත', body: 'වෙනත් අයෙකු එය භාරගෙන ඇත, නැතහොත් කාර්යාලය එය ඉල්ලා අස්කර ගෙන ඇත. ඔබෙන් කිසිවක් අවශ්‍ය නොවේ.' },
  ta: { title: 'ஒரு வேலை வாய்ப்பு இனி திறந்திருக்கவில்லை', body: 'வேறொருவர் அதை ஏற்றுக்கொண்டார், அல்லது அலுவலகம் அதைத் திரும்பப் பெற்றது. உங்களிடமிருந்து எதுவும் தேவையில்லை.' },
} as const;

/**
 * Job offers: staff (and, later, the matching agent) offer a request to
 * caregivers; a caregiver accepts or declines before the deadline; the first
 * acceptance takes the job and the request gets its caregiver.
 *
 * An accepted offer does not make the booking by itself - a request does not
 * carry a schedule - but it carries the agreed rates to the booking form, so
 * nobody types them again.
 */
@Injectable()
export class OffersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly requests: CareRequestsService,
    private readonly pricing: PricingService,
    private readonly notices: NotificationsService,
    private readonly email: EmailService,
    private readonly jobs: JobsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
  ) {}

  onApplicationBootstrap() {
    this.jobs.register(EXPIRE_JOB, async (payload) => void (await this.expire(String(payload.offerId))));
  }

  // --- staff ---------------------------------------------------------------------

  private async toStaff(rows: OfferRow[], now = new Date()): Promise<StaffCareOffer[]> {
    if (!rows.length) return [];
    const [people, senders] = await Promise.all([
      this.db.select({ id: caregivers.id, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber }).from(caregivers).where(inArray(caregivers.id, [...new Set(rows.map((r) => r.caregiverId))])),
      this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.sentByUserId).filter((v): v is string => Boolean(v))), ''])),
    ]);
    const cg = new Map(people.map((p) => [p.id, p]));
    const who = new Map(senders.map((s) => [s.id, s.fullName]));
    return rows.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      caregiver: cg.get(r.caregiverId) ?? { id: r.caregiverId, fullName: '-', registrationNumber: '-' },
      status: effectiveCareOfferStatus(r.status, r.expiresAt, now),
      rateType: r.rateType,
      payRate: r.payRate,
      clientRate: r.clientRate,
      note: r.note,
      declineReason: r.declineReason,
      sentByName: r.sentByUserId ? (who.get(r.sentByUserId) ?? null) : null,
      expiresAt: r.expiresAt.toISOString(),
      respondedAt: r.respondedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async forRequest(requestId: string): Promise<StaffCareOffer[]> {
    return this.toStaff(await this.db.select().from(requestOffers).where(eq(requestOffers.requestId, requestId)).orderBy(desc(requestOffers.createdAt)));
  }

  /**
   * Offers the request to one caregiver. The rates come from the caregiver's
   * own rate for this kind of care when there is a usable one; otherwise from
   * what staff typed in; otherwise the offer says "rate to be agreed".
   */
  async send(requestId: string, dto: SendOfferDto, actor: Pick<AuthenticatedUser, 'userId'>, now = new Date()): Promise<StaffCareOffer[]> {
    const [request] = await this.db.select().from(careRequests).where(eq(careRequests.id, requestId)).limit(1);
    if (!request) throw new NotFoundException('Request not found');
    if (!OPEN_CARE_REQUEST_STATUSES.includes(request.status)) throw new BadRequestException('Offers can only be sent while the request is open');
    const [caregiver] = await this.db
      .select({ id: caregivers.id, userId: caregivers.userId, status: caregivers.status })
      .from(caregivers)
      .where(and(eq(caregivers.id, dto.caregiverId), isNull(caregivers.deletedAt)))
      .limit(1);
    if (!caregiver) throw new NotFoundException('Caregiver not found');
    if ((dto.payRate === undefined) !== (dto.rateType === undefined)) throw new BadRequestException('Give both the rate and what it is per');

    const existing = await this.db.select().from(requestOffers).where(eq(requestOffers.requestId, requestId));
    if (existing.some((o) => o.status === 'ACCEPTED')) throw new BadRequestException('A caregiver has already accepted this request');
    const waiting = existing.filter((o) => effectiveCareOfferStatus(o.status, o.expiresAt, now) === 'OFFERED');
    if (waiting.some((o) => o.caregiverId === dto.caregiverId)) throw new ConflictException('This caregiver already has an offer waiting for this request');
    if (waiting.length >= MAX_OPEN_CARE_OFFERS) throw new BadRequestException('Too many offers are waiting on this request. Withdraw one first');
    // An offer whose time ran out but which the clean-up has not reached yet would block the unique key: close it now.
    const stale = existing.filter((o) => o.status === 'OFFERED' && o.caregiverId === dto.caregiverId);
    for (const o of stale) await this.expire(o.id, now);

    const quote = request.careType ? await this.pricing.quote(dto.caregiverId, request.careType) : null;
    const rates = quote
      ? { rateType: quote.rateType, payRate: quote.payRate, clientRate: quote.clientRate }
      : dto.payRate !== undefined
        ? { rateType: dto.rateType!, payRate: dto.payRate, clientRate: null }
        : { rateType: null, payRate: null, clientRate: null };

    const id = uuid();
    const expiresAt = new Date(now.getTime() + (dto.expiresInMinutes ?? CARE_OFFER_MINUTES.default) * 60_000);
    try {
      await this.db.insert(requestOffers).values({ id, requestId, caregiverId: dto.caregiverId, ...rates, note: dto.note ?? null, sentByUserId: actor.userId, expiresAt, createdAt: now });
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictException('This caregiver already has an offer waiting for this request');
      throw err;
    }
    await this.jobs.enqueue(EXPIRE_JOB, { offerId: id }, { runAt: expiresAt, uniqueKey: expiryKey(id), maxAttempts: 3 });
    this.notices.notify([caregiver.userId], (lang) => NEW_OFFER[lang], '/care-offers', `offer ${id}`);
    await this.messageNewOffer(id, dto.caregiverId, expiresAt);
    return this.forRequest(requestId);
  }

  /**
   * An offer runs out, so the caregiver also gets a message outside the app:
   * WhatsApp when updates can go out that way, otherwise email. It says only
   * that there is an offer, until when, and where to answer - nothing about
   * the client or the job, which they read after signing in. A caregiver who
   * asked to be phoned gets no message (staff call them; the bell still shows it).
   * A message that fails never fails the offer.
   */
  private async messageNewOffer(offerId: string, caregiverId: string, expiresAt: Date): Promise<void> {
    try {
      const [who] = await this.db
        .select({ accountPhone: users.phone, email: users.email, primaryPhone: caregivers.primaryPhone, preferred: caregivers.preferredContactMethod })
        .from(caregivers)
        .leftJoin(users, eq(users.id, caregivers.userId))
        .where(eq(caregivers.id, caregiverId))
        .limit(1);
      if (!who || who.preferred === 'PHONE_CALL') return;
      const url = `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}/caregiver/care-offers`;
      const until = offerDeadline(expiresAt);
      const wa = await this.whatsappSettings.getResolved();
      const phone = who.accountPhone ?? normalizePhone(who.primaryPhone, await this.whatsappSettings.getDefaultCountryCode());
      if (phone && this.whatsapp.canSendUpdates(wa)) {
        const text = (['en', 'si', 'ta'] as const).map((l) => `${NEW_OFFER[l].title}. ${NEW_OFFER_UNTIL[l].replace('{until}', until)}`).join(' / ');
        await this.whatsapp.sendUpdate(wa, phone, 'en', `{brand}: ${text} ${url}`);
        return;
      }
      if (who.email) {
        await this.email.sendNotificationEmail(
          who.email,
          {
            subject: `{brand} - ${NEW_OFFER.en.title}`,
            blocks: (['en', 'si', 'ta'] as const).map((l) => ({ lang: l, heading: NEW_OFFER[l].title, paragraphs: [NEW_OFFER_UNTIL[l].replace('{until}', until)] })),
            cta: { label: '{brand}', url },
          },
          `offer ${offerId}`,
        );
      }
    } catch (err) {
      this.logger.error(`Offer ${offerId}: the caregiver could not be messaged: ${(err as Error).message}`);
    }
  }

  /** Staff take an offer back before it is answered. */
  async withdraw(requestId: string, offerId: string): Promise<StaffCareOffer[]> {
    const [result] = await this.db
      .update(requestOffers)
      .set({ status: 'WITHDRAWN', respondedAt: new Date() })
      .where(and(eq(requestOffers.id, offerId), eq(requestOffers.requestId, requestId), eq(requestOffers.status, 'OFFERED')));
    if (!(result as { affectedRows: number }).affectedRows) throw new BadRequestException('Only an offer that is still waiting can be withdrawn');
    await this.jobs.cancel(expiryKey(offerId));
    await this.tellNoLongerOpen([offerId]);
    await nudgeMatching(this.jobs, this.automation, requestId);
    return this.forRequest(requestId);
  }

  /** Marks an unanswered offer expired once its time is up. Safe to call again. */
  async expire(offerId: string, now = new Date()): Promise<boolean> {
    const [result] = await this.db
      .update(requestOffers)
      .set({ status: 'EXPIRED' })
      .where(and(eq(requestOffers.id, offerId), eq(requestOffers.status, 'OFFERED'), lte(requestOffers.expiresAt, now)));
    const expired = (result as { affectedRows: number }).affectedRows > 0;
    if (expired) {
      // The matching agent, if it is working on this request, offers the job to the next caregiver.
      const [row] = await this.db.select({ requestId: requestOffers.requestId }).from(requestOffers).where(eq(requestOffers.id, offerId)).limit(1);
      if (row) await nudgeMatching(this.jobs, this.automation, row.requestId);
    }
    return expired;
  }

  /**
   * The rates a booking made from this request should start with: those of
   * the offer its caregiver accepted. Null when no offer was accepted.
   */
  async acceptedFor(requestId: string): Promise<StaffCareOffer | null> {
    const [row] = await this.db.select().from(requestOffers).where(and(eq(requestOffers.requestId, requestId), eq(requestOffers.status, 'ACCEPTED'))).limit(1);
    return row ? (await this.toStaff([row]))[0] : null;
  }

  // --- the caregiver -------------------------------------------------------------

  private caregiverIdOf(user: AuthenticatedUser): string {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('Only caregivers have job offers');
    return user.caregiverId;
  }

  /** Waiting offers first (soonest deadline first), then the last 30 days of answered ones. */
  async forCaregiver(user: AuthenticatedUser, now = new Date()): Promise<CaregiverCareOffer[]> {
    const caregiverId = this.caregiverIdOf(user);
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const rows = await this.db
      .select({
        offer: requestOffers,
        reference: careRequests.reference,
        careType: careRequests.careType,
        // The area the care is needed in: the request's own, or else where the client lives.
        // District and city only - never the address.
        districtId: sql<number | null>`COALESCE(${careRequests.districtId}, ${patients.districtId})`,
        cityId: sql<number | null>`COALESCE(${careRequests.cityId}, ${patients.cityId})`,
        desiredStartDate: careRequests.desiredStartDate,
      })
      .from(requestOffers)
      .innerJoin(careRequests, eq(careRequests.id, requestOffers.requestId))
      .leftJoin(patients, eq(patients.id, careRequests.patientId))
      .where(and(eq(requestOffers.caregiverId, caregiverId), gt(requestOffers.createdAt, since)))
      .orderBy(desc(requestOffers.createdAt))
      .limit(100);
    const districtIds = [...new Set(rows.map((r) => r.districtId).filter((v): v is number => v !== null))];
    const cityIds = [...new Set(rows.map((r) => r.cityId).filter((v): v is number => v !== null))];
    const districtRows = districtIds.length ? await this.db.select().from(districts).where(inArray(districts.id, districtIds)) : [];
    const cityRows = cityIds.length ? await this.db.select().from(cities).where(inArray(cities.id, cityIds)) : [];
    const name = (r?: { nameEn: string; nameSi: string; nameTa: string }): LocalPlaceName | null => (r ? { en: r.nameEn, si: r.nameSi, ta: r.nameTa } : null);
    const offers = rows.map(({ offer, ...request }): CaregiverCareOffer => ({
      id: offer.id,
      reference: request.reference,
      status: effectiveCareOfferStatus(offer.status, offer.expiresAt, now),
      careType: request.careType,
      district: name(districtRows.find((d) => d.id === request.districtId)),
      city: name(cityRows.find((c) => c.id === request.cityId)),
      desiredStartDate: request.desiredStartDate,
      rateType: offer.rateType,
      payRate: offer.payRate,
      note: offer.note,
      expiresAt: offer.expiresAt.toISOString(),
      respondedAt: offer.respondedAt?.toISOString() ?? null,
      createdAt: offer.createdAt.toISOString(),
    }));
    const waiting = offers.filter((o) => o.status === 'OFFERED').sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    return [...waiting, ...offers.filter((o) => o.status !== 'OFFERED')];
  }

  private async ownOffer(user: AuthenticatedUser, offerId: string): Promise<OfferRow> {
    const caregiverId = this.caregiverIdOf(user);
    const [row] = await this.db.select().from(requestOffers).where(and(eq(requestOffers.id, offerId), eq(requestOffers.caregiverId, caregiverId))).limit(1);
    // Someone else's offer answers exactly as one that does not exist.
    if (!row) throw new NotFoundException('Offer not found');
    return row;
  }

  /**
   * Accepts. Under a lock on the request, so when two caregivers press Accept
   * at the same moment exactly one gets the job; the other is told it has
   * gone. Every other waiting offer on the request is withdrawn.
   */
  async accept(user: AuthenticatedUser, offerId: string, now = new Date()): Promise<CaregiverCareOffer[]> {
    const offer = await this.ownOffer(user, offerId);
    const withdrawn: string[] = [];
    await this.db.transaction(async (tx) => {
      const [request] = await tx.select({ status: careRequests.status }).from(careRequests).where(eq(careRequests.id, offer.requestId)).for('update').limit(1);
      const [mine] = await tx.select().from(requestOffers).where(eq(requestOffers.id, offerId)).limit(1);
      if (mine.status === 'ACCEPTED') return; // pressed twice
      const [taken] = await tx.select({ id: requestOffers.id }).from(requestOffers).where(and(eq(requestOffers.requestId, offer.requestId), eq(requestOffers.status, 'ACCEPTED'))).limit(1);
      if (taken || mine.status === 'WITHDRAWN') throw new ConflictException('This job is no longer open');
      if (mine.status === 'DECLINED') throw new BadRequestException('You have already declined this offer');
      if (mine.status === 'EXPIRED' || mine.expiresAt.getTime() <= now.getTime()) throw new BadRequestException('The time to answer this offer has passed');
      if (!request || !OPEN_CARE_REQUEST_STATUSES.includes(request.status)) throw new ConflictException('This job is no longer open');

      await tx.update(requestOffers).set({ status: 'ACCEPTED', respondedAt: now }).where(eq(requestOffers.id, offerId));
      const others = await tx.select({ id: requestOffers.id }).from(requestOffers).where(and(eq(requestOffers.requestId, offer.requestId), eq(requestOffers.status, 'OFFERED'), ne(requestOffers.id, offerId)));
      if (others.length) {
        await tx.update(requestOffers).set({ status: 'WITHDRAWN', respondedAt: now }).where(inArray(requestOffers.id, others.map((o) => o.id)));
        withdrawn.push(...others.map((o) => o.id));
      }
    });

    await this.jobs.cancel(expiryKey(offerId));
    for (const id of withdrawn) await this.jobs.cancel(expiryKey(id));
    await this.afterAccepted(offer, user).catch((e) => this.logger.error(`Offer ${offerId} accepted, but the request could not be updated: ${(e as Error).message}`));
    await this.tellNoLongerOpen(withdrawn);
    return this.forCaregiver(user, now);
  }

  /** The request gets its caregiver and a note, and the staff member who sent the offer is told. */
  private async afterAccepted(offer: OfferRow, user: AuthenticatedUser) {
    const actor = { ...user };
    await this.requests.setCaregiver(offer.requestId, offer.caregiverId, actor);
    await this.requests.addNote(offer.requestId, 'The caregiver accepted the job offer', actor);
    await nudgeMatching(this.jobs, this.automation, offer.requestId);
    // The booking agent, when it is switched on, drafts the booking.
    await nudgeBooking(this.jobs, this.automation, offer.requestId);
    if (!offer.sentByUserId) return;
    const [[sender], [request], [caregiver]] = await Promise.all([
      this.db.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, offer.sentByUserId)).limit(1),
      this.db.select({ reference: careRequests.reference }).from(careRequests).where(eq(careRequests.id, offer.requestId)).limit(1),
      this.db.select({ registrationNumber: caregivers.registrationNumber }).from(caregivers).where(eq(caregivers.id, offer.caregiverId)).limit(1),
    ]);
    if (!sender?.email || !sender.isActive) return;
    await this.email.sendNotificationEmail(
      [sender.email],
      {
        subject: `Offer accepted: ${request.reference}`,
        blocks: [{ lang: 'en', heading: `A caregiver accepted your offer on ${request.reference}`, paragraphs: [`${caregiver.registrationNumber} is now attached to the request.`, 'Open the request to make the booking; the agreed rates are filled in for you.'] }],
      },
      `offer accepted ${offer.id}`,
    );
  }

  async decline(user: AuthenticatedUser, offerId: string, reason: CareOfferDeclineReason | undefined, now = new Date()): Promise<CaregiverCareOffer[]> {
    const offer = await this.ownOffer(user, offerId);
    const [result] = await this.db
      .update(requestOffers)
      .set({ status: 'DECLINED', declineReason: reason ?? null, respondedAt: now })
      .where(and(eq(requestOffers.id, offerId), eq(requestOffers.status, 'OFFERED'), gt(requestOffers.expiresAt, now)));
    if (!(result as { affectedRows: number }).affectedRows) throw new BadRequestException('This offer is no longer waiting for an answer');
    await this.jobs.cancel(expiryKey(offerId));
    await nudgeMatching(this.jobs, this.automation, offer.requestId);
    return this.forCaregiver(user, now);
  }

  private async tellNoLongerOpen(offerIds: string[]) {
    if (!offerIds.length) return;
    const rows = await this.db
      .select({ userId: caregivers.userId })
      .from(requestOffers)
      .innerJoin(caregivers, eq(caregivers.id, requestOffers.caregiverId))
      .where(inArray(requestOffers.id, offerIds));
    this.notices.notify(rows.map((r) => r.userId), (lang) => OFFER_FILLED[lang], '/care-offers', 'offer no longer open');
  }

  /** How many offers are waiting on this caregiver right now - for a number on their menu. */
  async waitingCount(user: AuthenticatedUser, now = new Date()): Promise<number> {
    const caregiverId = this.caregiverIdOf(user);
    const [{ n }] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(requestOffers)
      .where(and(eq(requestOffers.caregiverId, caregiverId), eq(requestOffers.status, 'OFFERED'), gt(requestOffers.expiresAt, now)));
    return Number(n);
  }
}

function isDuplicate(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === 'ER_DUP_ENTRY' || e?.cause?.code === 'ER_DUP_ENTRY';
}
