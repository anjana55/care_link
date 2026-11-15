import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { PUBLIC_CAREGIVER_STATUSES, addDays, colomboToday, rateProblem, type CareType } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { CARE_TYPE_COLUMNS, availability, bookings, careTypePricing, caregiverRates, caregivers, cities, preferredLocations, requestOffers } from '../database/schema';
import { ReviewStore } from '../reviews/review-store.service';
import { ReviewSettingsService } from '../reviews/review-settings.service';
import { ratingSignal } from '../reviews/review-rules';
import type { MatchCandidate, MatchRequest } from './matching-rules';

/** The most caregivers scored for one request or shift. */
const POOL_LIMIT = 300;
const VERIFIED = new Set(['VERIFIED', 'ACTIVE']);
/** A DATE column as YYYY-MM-DD, read with the same clock the driver built it with. */
const dayOf = (d: Date | string | null): string | null =>
  !d ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10);

/**
 * Who could take a job: the hard checks, in code, and the facts the matching
 * rules score. Used by the matching agent (a new request) and by cover (one
 * shift whose caregiver cannot come), so both choose people the same way.
 * It reads; it never offers anything to anyone.
 */
@Injectable()
export class CandidatePoolService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly reviewStore: ReviewStore,
    private readonly reviewSettings: ReviewSettingsService,
  ) {}

  /**
   * Everyone who passes the hard checks, with what the rules need to know
   * about them: listed, has an account to answer on, lives in or travels to
   * the district, matches a stated gender preference, is not in `exclude`,
   * and - unless `anyCareType` - does this kind of care.
   */
  async pool(match: MatchRequest, opts: { genderPreference?: string | null; exclude?: Set<string>; anyCareType?: boolean }, now = new Date()): Promise<MatchCandidate[]> {
    const exclude = opts.exclude ?? new Set<string>();
    const travelsToDistrict = exists(
      this.db
        .select({ one: sql`1` })
        .from(preferredLocations)
        .innerJoin(cities, eq(cities.id, preferredLocations.cityId))
        .where(and(eq(preferredLocations.caregiverId, caregivers.id), eq(cities.districtId, match.districtId))),
    );
    const rows = await this.db
      .select({
        id: caregivers.id,
        registrationNumber: caregivers.registrationNumber,
        status: caregivers.status,
        gender: caregivers.gender,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
        avail: availability,
      })
      .from(caregivers)
      .leftJoin(availability, eq(availability.caregiverId, caregivers.id))
      .where(
        and(
          isNull(caregivers.deletedAt),
          isNotNull(caregivers.userId),
          inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]),
          or(eq(caregivers.districtId, match.districtId), travelsToDistrict),
          opts.genderPreference === 'MALE' || opts.genderPreference === 'FEMALE' ? eq(caregivers.gender, opts.genderPreference) : undefined,
        ),
      )
      .orderBy(caregivers.registrationNumber)
      .limit(POOL_LIMIT * 2);
    const column = CARE_TYPE_COLUMNS[match.careType as keyof typeof CARE_TYPE_COLUMNS];
    // No availability record yet means nothing has been narrowed down: every kind of care is on (as on the rate card).
    const fit = rows.filter((r) => !exclude.has(r.id) && (opts.anyCareType || !column || (r.avail ? Boolean(r.avail[column]) : true))).slice(0, POOL_LIMIT);
    if (!fit.length) return [];
    const ids = fit.map((r) => r.id);

    const startDay = match.desiredStartDate ?? colomboToday(now);
    const [stats, settings, [pricing], rates, travels, running, history] = await Promise.all([
      this.reviewStore.statsFor(ids),
      this.reviewSettings.getResolved(),
      this.db.select().from(careTypePricing).where(eq(careTypePricing.careType, match.careType as CareType)).limit(1),
      this.db.select().from(caregiverRates).where(and(inArray(caregiverRates.caregiverId, ids), eq(caregiverRates.careType, match.careType as CareType))),
      match.cityId
        ? this.db.select({ caregiverId: preferredLocations.caregiverId }).from(preferredLocations).where(and(inArray(preferredLocations.caregiverId, ids), eq(preferredLocations.cityId, match.cityId)))
        : Promise.resolve([] as { caregiverId: string }[]),
      this.db
        .select({ caregiverId: bookings.caregiverId, n: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(inArray(bookings.caregiverId, ids), eq(bookings.status, 'CONFIRMED'), lte(bookings.startDate, addDays(startDay, 7)), gte(bookings.endDate, startDay)))
        .groupBy(bookings.caregiverId),
      this.db
        .select({ caregiverId: requestOffers.caregiverId, status: requestOffers.status, n: sql<number>`COUNT(*)` })
        .from(requestOffers)
        // Job offers only: a cover offer gives a quarter of an hour, and missing one says little about how someone answers a job.
        .where(and(inArray(requestOffers.caregiverId, ids), eq(requestOffers.kind, 'JOB'), gte(requestOffers.createdAt, new Date(now.getTime() - 30 * 86_400_000)), inArray(requestOffers.status, ['DECLINED', 'EXPIRED', 'ACCEPTED'])))
        .groupBy(requestOffers.caregiverId, requestOffers.status),
    ]);
    const rateOf = new Map(rates.map((r) => [r.caregiverId, r.amount]));
    const travelsTo = new Set(travels.map((t) => t.caregiverId));
    const runningOf = new Map(running.map((r) => [r.caregiverId, Number(r.n)]));
    const count = (id: string, statuses: string[]) => history.filter((h) => h.caregiverId === id && statuses.includes(h.status)).reduce((sum, h) => sum + Number(h.n), 0);

    return fit.map((r) => {
      const s = stats.get(r.id);
      const signal = settings.enabled && s ? ratingSignal(s.ratingCount, s.ratingSum, settings.minRatingsToShow) : null;
      const amount = rateOf.get(r.id);
      const usable = pricing && amount !== undefined && rateProblem(amount, pricing) === null;
      const availableFrom = dayOf(r.avail?.availableFrom ?? null);
      return {
        caregiverId: r.id,
        registrationNumber: r.registrationNumber,
        verified: VERIFIED.has(r.status),
        sameCity: match.cityId !== null && r.cityId === match.cityId,
        sameDistrict: r.districtId === match.districtId,
        travelsToCity: travelsTo.has(r.id),
        dayDuty: Boolean(r.avail?.dayDuty),
        nightDuty: Boolean(r.avail?.nightDuty),
        liveIn24h: Boolean(r.avail?.liveIn24h),
        ratingSignal: signal,
        ratingAverage: signal !== null && s ? s.ratingSum / s.ratingCount : null,
        ratingCount: s?.ratingCount ?? 0,
        ownRate: usable ? { amount: amount!, rateType: pricing.rateType } : null,
        availableFrom,
        runningBookings: runningOf.get(r.id) ?? 0,
        recentUnanswered: count(r.id, ['DECLINED', 'EXPIRED']),
        recentAccepted: count(r.id, ['ACCEPTED']),
      } satisfies MatchCandidate;
    });
  }
}
