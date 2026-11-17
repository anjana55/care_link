import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  MAX_OPEN_COVER_OFFERS,
  coverOfferMinutes,
  effectiveCareOfferStatus,
  toColombo,
  type CoverBlock,
  type CoverSuggestion,
  type PricingRateType,
  type ShiftCover,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { BLOCKING_SHIFT_STATUSES, bookingShifts, bookings, careRequests, caregivers, patients, requestOffers, shiftCheckins, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { OffersService, isDuplicateOffer, offerExpiryKey, type CoverAccept } from '../offers/offers.service';
import { BookingsService } from '../bookings/bookings.service';
import type { UpdateShiftDto } from '../bookings/dto/booking.dto';
import { CorrectionsService } from '../corrections/corrections.service';
import type { AmendBookingDto } from '../corrections/dto/amend-booking.dto';
import { CandidatePoolService } from '../matching/candidate-pool.service';
import { rankMatches, type RankedMatch } from '../matching/matching-rules';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { JobsService } from '../jobs/jobs.service';
import { AutomationService } from '../automation/automation.service';
import { COVER_CLOSE_JOB } from './cover-jobs';
import { coverRequest } from './cover-rules';
import type { SendCoverOffersDto } from './dto/cover.dto';

/** Suggestions shown to staff at a time. */
const SUGGESTIONS = 8;

/** "Your shift went to someone else" - the caregiver who could not be reached, in their language. */
const SHIFT_COVERED = {
  en: { title: 'Your shift has been given to another caregiver', body: 'Your {time} shift on {date} is now covered by someone else. You do not need to go. Call the office if you have questions.' },
  si: { title: 'ඔබගේ වාරය වෙනත් රැකවරණ සේවකයෙකුට ලබා දී ඇත', body: '{date} දින {time} ට ඇති ඔබගේ වාරය දැන් වෙනත් අයෙකු විසින් ආවරණය කරයි. ඔබ යා යුතු නැත. ප්‍රශ්න ඇත්නම් කාර්යාලයට අමතන්න.' },
  ta: { title: 'உங்கள் பணிநேரம் வேறொரு பராமரிப்பாளருக்கு வழங்கப்பட்டது', body: '{date} அன்று {time} மணிக்கான உங்கள் பணிநேரத்தை இப்போது வேறொருவர் ஏற்றுக்கொண்டுள்ளார். நீங்கள் செல்லத் தேவையில்லை. கேள்விகள் இருந்தால் அலுவலகத்தை அழைக்கவும்.' },
} as const;
/** "Someone else is coming" - the client, in their language. Their arrival code is the shift's, so it has not changed. */
const COVER_COMING = {
  en: { title: 'A different caregiver is coming', body: '{name} will cover your {time} visit on {date}. Give them the same arrival code when they reach you.' },
  si: { title: 'වෙනත් රැකවරණ සේවකයෙකු පැමිණේ', body: '{date} දින {time} ට ඇති ඔබගේ හමුව {name} විසින් ආවරණය කරනු ඇත. ඔවුන් පැමිණි විට එම පැමිණීමේ කේතයම ලබා දෙන්න.' },
  ta: { title: 'வேறொரு பராமரிப்பாளர் வருகிறார்', body: '{date} அன்று {time} மணிக்கான உங்கள் வருகையை {name} கவனிப்பார். அவர் வந்ததும் அதே வருகைக் குறியீட்டைக் கொடுங்கள்.' },
} as const;

type ShiftRow = {
  shiftId: string;
  bookingId: string;
  reference: string;
  bookingStatus: string;
  bookedCaregiverId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status: string;
  caregiverId: string;
  caregiverName: string;
  registration: string;
  caregiverUserId: string | null;
  shiftPayType: string | null;
  shiftPayAmount: string | null;
  bookingPayType: string | null;
  bookingPayAmount: string | null;
  patientUserId: string | null;
  genderPreference: string | null;
  careType: string | null;
  districtId: number | null;
  cityId: number | null;
  checkedInAt: Date | string | null;
};

/**
 * Cover for one shift whose caregiver cannot come: the shift is offered to
 * other caregivers the same way a new job is, and the first to accept is put
 * on it.
 *
 * - Who is asked: the matching rules, over caregivers who pass the hard
 *   checks (listed, with an account, in or travelling to the area, the
 *   client's stated preference) and who are free at that time.
 * - What they are told: the day and time, the area, the pay. Nothing about
 *   the client - that comes with the shift once they have accepted.
 * - What changes when someone accepts: the shift's caregiver, through the
 *   same service the staff page uses. The client's price and the shift's
 *   pay do not change. The client and the caregiver who was replaced are told.
 *
 * A shift already on an invoice (a client billed in advance) or a pay
 * statement is covered the same way; the change of caregiver is then made as
 * a correction on the booking, which keeps the documents in step. The
 * client's invoice does not change: the price is the shift's, whoever comes.
 */
@Injectable()
export class CoverService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CoverService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly offers: OffersService,
    private readonly bookingsService: BookingsService,
    private readonly corrections: CorrectionsService,
    private readonly pools: CandidatePoolService,
    private readonly notices: NotificationsService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly jobs: JobsService,
    private readonly automation: AutomationService,
  ) {}

  onApplicationBootstrap() {
    this.offers.registerCoverAccept(this.accept);
    this.jobs.register(COVER_CLOSE_JOB, async (payload) => {
      const shiftId = (payload as { shiftId?: unknown }).shiftId;
      if (typeof shiftId === 'string') await this.closeFor(shiftId);
    });
  }

  // --- reading -----------------------------------------------------------------

  async shift(shiftId: string): Promise<ShiftRow> {
    const [row] = await this.db
      .select({
        shiftId: bookingShifts.id,
        bookingId: bookings.id,
        reference: bookings.reference,
        bookingStatus: bookings.status,
        bookedCaregiverId: bookings.caregiverId,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        caregiverId: bookingShifts.caregiverId,
        caregiverName: caregivers.fullName,
        registration: caregivers.registrationNumber,
        caregiverUserId: caregivers.userId,
        shiftPayType: bookingShifts.payRateType,
        shiftPayAmount: bookingShifts.payRateAmount,
        bookingPayType: bookings.payRateType,
        bookingPayAmount: bookings.payRateAmount,
        patientUserId: patients.userId,
        genderPreference: patients.preferredCaregiverGender,
        careType: careRequests.careType,
        // Where the care is: the request's own area, or else where the client lives. District and city only.
        districtId: sql<number | null>`COALESCE(${careRequests.districtId}, ${patients.districtId})`,
        cityId: sql<number | null>`COALESCE(${careRequests.cityId}, ${patients.cityId})`,
        checkedInAt: shiftCheckins.checkedInAt,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .innerJoin(patients, eq(patients.id, bookings.patientId))
      .leftJoin(careRequests, eq(careRequests.id, bookings.careRequestId))
      .leftJoin(shiftCheckins, eq(shiftCheckins.shiftId, bookingShifts.id))
      .where(eq(bookingShifts.id, shiftId))
      .limit(1);
    if (!row) throw new NotFoundException('Shift not found');
    return row;
  }

  /** What the shift pays whoever works it: its own rate, or else the booking's. Null when that is by the month - one shift has no price then. */
  pay(row: ShiftRow): { rateType: PricingRateType; amount: number } | null {
    const type = row.shiftPayType ?? row.bookingPayType;
    const amount = row.shiftPayType ? row.shiftPayAmount : row.bookingPayAmount;
    if (!type || type === 'MONTHLY' || amount === null) return null;
    return { rateType: type as PricingRateType, amount: Number(amount) };
  }

  /** Why this shift cannot be offered as cover right now; null when it can. */
  blocked(row: ShiftRow, now = new Date()): CoverBlock | null {
    if (row.status !== 'SCHEDULED' || row.bookingStatus !== 'CONFIRMED') return 'NOT_SCHEDULED';
    if (new Date(row.endsAt).getTime() <= now.getTime()) return 'ENDED';
    if (row.checkedInAt) return 'CHECKED_IN';
    return null;
  }

  /** The invoice or pay statement this shift is already on, in words; null when it is on neither. */
  async billedOn(shiftId: string): Promise<string | null> {
    const refs = await this.bookingsService.billingRefs([shiftId]);
    const inv = refs.invoices.get(shiftId);
    const pay = refs.payouts.get(shiftId);
    if (!inv && !pay) return null;
    return [inv ? (inv.number ? `invoice ${inv.number}` : 'a draft invoice') : null, pay ? `pay statement ${pay.reference}` : null].filter(Boolean).join(' and ');
  }

  private refuse(block: CoverBlock): never {
    if (block === 'NOT_SCHEDULED') throw new BadRequestException('Only a scheduled shift can be offered as cover');
    if (block === 'ENDED') throw new BadRequestException('This shift is already over');
    throw new BadRequestException('The caregiver has checked in for this shift');
  }

  private offersFor(shiftId: string) {
    return this.db.select().from(requestOffers).where(and(eq(requestOffers.shiftId, shiftId), eq(requestOffers.kind, 'COVER'))).orderBy(desc(requestOffers.createdAt));
  }

  /** Caregivers who hold a shift that overlaps this one - they cannot take it. */
  private async busy(row: ShiftRow, only?: string[]): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ caregiverId: bookingShifts.caregiverId })
      .from(bookingShifts)
      .where(
        and(
          inArray(bookingShifts.status, [...BLOCKING_SHIFT_STATUSES]),
          lt(bookingShifts.startsAt, new Date(row.endsAt)),
          gt(bookingShifts.endsAt, new Date(row.startsAt)),
          ne(bookingShifts.id, row.shiftId),
          only ? inArray(bookingShifts.caregiverId, only) : undefined,
        ),
      );
    return new Set(rows.map((r) => r.caregiverId));
  }

  /**
   * Who could cover, best first: the matching rules over everyone who passes
   * the hard checks and is free then. Nobody on the shift or the booking, and
   * nobody who already has or had an offer for this shift.
   */
  async rank(row: ShiftRow, now = new Date()): Promise<RankedMatch[]> {
    if (row.districtId === null) return [];
    const [busy, asked] = await Promise.all([this.busy(row), this.offersFor(row.shiftId)]);
    const exclude = new Set([row.caregiverId, row.bookedCaregiverId, ...busy, ...asked.map((o) => o.caregiverId)]);
    const request = coverRequest({ startsAt: row.startsAt, endsAt: row.endsAt, careType: row.careType, districtId: row.districtId, cityId: row.cityId });
    const pool = await this.pools.pool(request, { genderPreference: row.genderPreference, exclude, anyCareType: !row.careType }, now);
    // The shift pays what it pays, and having other bookings is no drawback for someone free at this time:
    // neither the caregiver's own rate nor their running bookings should move them up or down.
    return rankMatches(request, pool.map((c) => ({ ...c, ownRate: null, runningBookings: 0, availableFrom: null })));
  }

  async forShift(shiftId: string, now = new Date()): Promise<ShiftCover> {
    const row = await this.shift(shiftId);
    const blocked = this.blocked(row, now);
    const [billedOn, offerRows] = await Promise.all([this.billedOn(shiftId), this.offersFor(shiftId)]);
    const ranked = blocked ? [] : (await this.rank(row, now)).slice(0, SUGGESTIONS);
    const people = ranked.length
      ? await this.db.select({ id: caregivers.id, fullName: caregivers.fullName, phone: caregivers.primaryPhone }).from(caregivers).where(inArray(caregivers.id, ranked.map((r) => r.caregiverId)))
      : [];
    const suggestions: CoverSuggestion[] = ranked.map((r) => {
      const p = people.find((x) => x.id === r.caregiverId);
      return { caregiverId: r.caregiverId, fullName: p?.fullName ?? '-', registrationNumber: r.registrationNumber, phone: p?.phone ?? null, score: r.score, reasons: r.reasons };
    });
    return {
      shiftId,
      bookingId: row.bookingId,
      bookingReference: row.reference,
      startsAt: new Date(row.startsAt).toISOString(),
      endsAt: new Date(row.endsAt).toISOString(),
      caregiver: { id: row.caregiverId, fullName: row.caregiverName, registrationNumber: row.registration },
      isCover: row.caregiverId !== row.bookedCaregiverId,
      blocked,
      billedOn,
      pay: this.pay(row),
      offerMinutes: coverOfferMinutes(row, now),
      offers: await this.offers.toStaff(offerRows, now),
      suggestions,
    };
  }

  // --- offering ----------------------------------------------------------------

  /**
   * Offers the shift to these caregivers. All of them or none: one who cannot
   * take it (busy then, already asked, not found) refuses the whole send, so
   * staff see why before anyone is messaged.
   */
  async send(shiftId: string, dto: SendCoverOffersDto, actor: Pick<AuthenticatedUser, 'userId'>, now = new Date()): Promise<ShiftCover> {
    const row = await this.shift(shiftId);
    const blocked = this.blocked(row, now);
    if (blocked) this.refuse(blocked);
    const ids = [...new Set(dto.caregiverIds)];
    const result = await this.offerTo(row, ids, { minutes: dto.expiresInMinutes, note: dto.note ?? null, sentByUserId: actor.userId, strict: true }, now);
    if (!result.sent.length) throw new BadRequestException('Choose at least one caregiver');
    return this.forShift(shiftId, now);
  }

  /**
   * The sending itself, shared by staff and the agent. `strict` (staff)
   * throws on the first caregiver who cannot be offered the shift; otherwise
   * (the agent) that caregiver is skipped and the rest go out.
   */
  async offerTo(
    row: ShiftRow,
    caregiverIds: string[],
    opts: { minutes?: number; note: string | null; sentByUserId: string; strict: boolean },
    now = new Date(),
  ): Promise<{ sent: string[]; skipped: { caregiverId: string; why: string }[]; expiresAt: Date }> {
    const minutes = Math.min(opts.minutes ?? coverOfferMinutes(row, now), Math.max(1, Math.floor((new Date(row.endsAt).getTime() - now.getTime()) / 60_000)));
    const expiresAt = new Date(now.getTime() + minutes * 60_000);
    const out = { sent: [] as string[], skipped: [] as { caregiverId: string; why: string }[], expiresAt };
    if (!caregiverIds.length) return out;

    const [existing, people, busy] = await Promise.all([
      this.offersFor(row.shiftId),
      this.db.select({ id: caregivers.id, userId: caregivers.userId }).from(caregivers).where(and(inArray(caregivers.id, caregiverIds), isNull(caregivers.deletedAt))),
      this.busy(row, caregiverIds),
    ]);
    const waiting = existing.filter((o) => effectiveCareOfferStatus(o.status, o.expiresAt, now) === 'OFFERED');
    if (waiting.length + caregiverIds.length > MAX_OPEN_COVER_OFFERS) {
      if (opts.strict) throw new BadRequestException('Too many cover offers are waiting on this shift. Withdraw one first');
      caregiverIds = caregiverIds.slice(0, Math.max(0, MAX_OPEN_COVER_OFFERS - waiting.length));
    }

    const problems = new Map<string, () => never>();
    for (const id of caregiverIds) {
      const person = people.find((p) => p.id === id);
      if (!person) problems.set(id, () => { throw new NotFoundException('Caregiver not found'); });
      else if (id === row.caregiverId) problems.set(id, () => { throw new BadRequestException('This caregiver is already on the shift'); });
      else if (busy.has(id)) problems.set(id, () => { throw new ConflictException('This caregiver has another shift at that time'); });
      else if (waiting.some((o) => o.caregiverId === id)) problems.set(id, () => { throw new ConflictException('This caregiver already has a cover offer waiting for this shift'); });
    }
    if (opts.strict) for (const fail of problems.values()) fail();

    const pay = this.pay(row);
    for (const id of caregiverIds) {
      if (problems.has(id)) {
        out.skipped.push({ caregiverId: id, why: 'cannot be offered this shift' });
        continue;
      }
      // An offer whose time ran out but which the clean-up has not reached yet would block the unique key: close it now.
      for (const o of existing.filter((x) => x.status === 'OFFERED' && x.caregiverId === id)) await this.offers.expire(o.id, now);
      try {
        await this.offers.issue(
          {
            kind: 'COVER',
            requestId: null,
            shiftId: row.shiftId,
            caregiverId: id,
            caregiverUserId: people.find((p) => p.id === id)!.userId,
            rateType: pay?.rateType ?? null,
            payRate: pay?.amount ?? null,
            // The client's price does not change with who comes.
            clientRate: null,
            note: opts.note,
            sentByUserId: opts.sentByUserId,
            expiresAt,
          },
          now,
        );
        out.sent.push(id);
      } catch (err) {
        if (opts.strict) throw isDuplicateOffer(err) ? new ConflictException('This caregiver already has a cover offer waiting for this shift') : err;
        out.skipped.push({ caregiverId: id, why: (err as Error).message });
      }
    }
    return out;
  }

  /** Staff take a cover offer back before it is answered. */
  async withdraw(shiftId: string, offerId: string): Promise<ShiftCover> {
    const [result] = await this.db
      .update(requestOffers)
      .set({ status: 'WITHDRAWN', respondedAt: new Date() })
      .where(and(eq(requestOffers.id, offerId), eq(requestOffers.shiftId, shiftId), eq(requestOffers.status, 'OFFERED')));
    if (!(result as { affectedRows: number }).affectedRows) throw new BadRequestException('Only an offer that is still waiting can be withdrawn');
    await this.jobs.cancel(offerExpiryKey(offerId));
    await this.offers.tellNoLongerOpen([offerId]);
    return this.forShift(shiftId);
  }

  /** The shift no longer needs cover (its caregiver checked in, or someone took it): every waiting offer is withdrawn and those caregivers told. */
  async closeFor(shiftId: string, except?: string): Promise<number> {
    const open = await this.db
      .select({ id: requestOffers.id })
      .from(requestOffers)
      .where(and(eq(requestOffers.shiftId, shiftId), eq(requestOffers.status, 'OFFERED'), except ? ne(requestOffers.id, except) : undefined));
    if (!open.length) return 0;
    const ids = open.map((o) => o.id);
    await this.db.update(requestOffers).set({ status: 'WITHDRAWN', respondedAt: new Date() }).where(and(inArray(requestOffers.id, ids), eq(requestOffers.status, 'OFFERED')));
    for (const id of ids) await this.jobs.cancel(offerExpiryKey(id));
    await this.offers.tellNoLongerOpen(ids);
    return ids.length;
  }

  // --- accepting ---------------------------------------------------------------

  /**
   * A caregiver accepts a cover offer. Under a lock on the shift, so when two
   * press Accept at the same moment exactly one gets it. The shift then moves
   * to them through the booking service, which checks again that they are free.
   */
  private readonly accept: CoverAccept = async (offer, user, now) => {
    const shiftId = offer.shiftId!;
    const before = await this.shift(shiftId);
    if (offer.status === 'OFFERED' && (await this.busy(before, [offer.caregiverId])).size) throw new ConflictException('You have another shift at that time');
    let already = false;
    await this.db.transaction(async (tx) => {
      const [shift] = await tx.select({ status: bookingShifts.status, endsAt: bookingShifts.endsAt }).from(bookingShifts).where(eq(bookingShifts.id, shiftId)).for('update').limit(1);
      const [mine] = await tx.select().from(requestOffers).where(eq(requestOffers.id, offer.id)).limit(1);
      if (mine.status === 'ACCEPTED') {
        already = true; // pressed twice
        return;
      }
      // Someone accepted since this offer was made. (An acceptance from an earlier round of cover on the same shift does not count.)
      const [taken] = await tx
        .select({ id: requestOffers.id })
        .from(requestOffers)
        .where(and(eq(requestOffers.shiftId, shiftId), eq(requestOffers.status, 'ACCEPTED'), gt(requestOffers.respondedAt, mine.createdAt)))
        .limit(1);
      if (taken || mine.status === 'WITHDRAWN') throw new ConflictException('This job is no longer open');
      if (mine.status === 'DECLINED') throw new BadRequestException('You have already declined this offer');
      if (mine.status === 'EXPIRED' || mine.expiresAt.getTime() <= now.getTime()) throw new BadRequestException('The time to answer this offer has passed');
      const [checkIn] = await tx.select({ at: shiftCheckins.checkedInAt }).from(shiftCheckins).where(eq(shiftCheckins.shiftId, shiftId)).limit(1);
      if (!shift || shift.status !== 'SCHEDULED' || new Date(shift.endsAt).getTime() <= now.getTime() || checkIn?.at) throw new ConflictException('This job is no longer open');
      await tx.update(requestOffers).set({ status: 'ACCEPTED', respondedAt: now }).where(eq(requestOffers.id, offer.id));
    });
    if (already) return;

    const row = before;
    try {
      if (await this.billedOn(shiftId)) {
        // Already on an invoice or a pay statement: the change is a correction, so the documents are kept in step
        // and the booking's history says why. No price changes, so nothing new is owed and nobody is billed again.
        const [cover] = await this.db.select({ reg: caregivers.registrationNumber }).from(caregivers).where(eq(caregivers.id, offer.caregiverId)).limit(1);
        const reason = `Cover for a caregiver who could not come: ${cover?.reg ?? 'another caregiver'} in place of ${row.registration}`;
        await this.corrections.apply(row.bookingId, { reason, shifts: [{ shiftId, caregiverId: offer.caregiverId }] } as AmendBookingDto, { ...user });
      } else {
        await this.bookingsService.updateShift(row.bookingId, shiftId, { caregiverId: offer.caregiverId } as UpdateShiftDto, { ...user });
      }
    } catch (err) {
      // The roster refused (the shift changed in the meantime). The offer is closed rather than
      // left accepted with nobody on the shift; the caregiver is told it has gone, and staff see the reason here.
      this.logger.warn(`Cover offer ${offer.id} was accepted but the shift could not be moved: ${(err as Error).message}`);
      await this.db.update(requestOffers).set({ status: 'WITHDRAWN', respondedAt: now }).where(and(eq(requestOffers.id, offer.id), eq(requestOffers.status, 'ACCEPTED')));
      await this.jobs.cancel(offerExpiryKey(offer.id));
      throw new ConflictException('This job is no longer open');
    }
    await this.jobs.cancel(offerExpiryKey(offer.id));
    await this.closeFor(shiftId, offer.id);
    await this.afterAccepted(row, offer).catch((e) => this.logger.error(`Cover offer ${offer.id} accepted, but not everyone could be told: ${(e as Error).message}`));
  };

  /** Tells the caregiver who was replaced, the client, and the office. `row` is the shift as it was before the change. */
  private async afterAccepted(row: ShiftRow, offer: { id: string; caregiverId: string; sentByUserId: string | null }) {
    const when = toColombo(row.startsAt);
    const fill = (text: string, name = '') => text.replace('{time}', when.time).replace('{date}', when.date).replace('{name}', name);
    const [cover] = await this.db.select({ fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber }).from(caregivers).where(eq(caregivers.id, offer.caregiverId)).limit(1);

    this.notices.notify([row.caregiverUserId], (lang) => ({ title: SHIFT_COVERED[lang].title, body: fill(SHIFT_COVERED[lang].body) }), '/shifts', `shift covered ${row.shiftId}`);
    this.notices.notify([row.patientUserId], (lang) => ({ title: COVER_COMING[lang].title, body: fill(COVER_COMING[lang].body, cover?.fullName ?? '') }), '/bookings', `cover coming ${row.shiftId}`);

    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: row.bookingId },
      {
        done: `${cover?.registrationNumber ?? 'A caregiver'} accepted the ${when.time} visit as cover for ${row.registration}; the client and ${row.registration} have been told`,
        waiting: 'The cover caregiver to check in',
        next: 'Nothing more on cover for this visit',
      },
    );

    // The office: whoever sent the offer, or - when the agent sent it - the alert list.
    const to = await this.officeRecipients(offer.sentByUserId);
    if (!to.length) return;
    const subject = `Cover found: ${row.reference}`;
    await this.email.sendNotificationEmail(
      to,
      {
        subject,
        blocks: [
          {
            lang: 'en',
            heading: subject,
            paragraphs: [
              `${cover?.registrationNumber ?? 'A caregiver'} accepted the ${when.time} visit on ${when.date} and is now on the shift in place of ${row.registration}.`,
              'The client and the caregiver who was replaced have been told. The shift keeps its times, its price and its pay.',
            ],
          },
        ],
        cta: { label: "Open Today's visits", url: `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}/bookings/today` },
      },
      `cover accepted ${offer.id}`,
    );
  }

  /** The staff member who sent the offer; or, for an offer the agent sent, the people who get operational alerts. */
  private async officeRecipients(sentByUserId: string | null): Promise<string[]> {
    if (sentByUserId) {
      const [sender] = await this.db.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, sentByUserId)).limit(1);
      if (sender?.isActive && sender.email) return [sender.email];
    }
    return this.staffRecipients();
  }

  /** The configured alert list, or else every active admin and staff account with an email address. */
  async staffRecipients(): Promise<string[]> {
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
