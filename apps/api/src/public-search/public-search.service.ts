import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type {
  CareType,
  CaregiverHomeLocation,
  GeoPoint,
  MapCityPoint,
  OriginSource,
  PublicCaregiverProfile,
  PublicCaregiverSummary,
  PublicSearchResponse,
  SearchOrigin,
  ServiceAreaCity,
} from '@care-platform/shared';
import {
  resolveLocale,
  type Locale,
  addDays,
  colomboToUtc,
  isValidDate,
  haversineKm,
  roundKm,
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_DEVICE_DISTANCE_FROM_CITY_KM,
  PUBLIC_CAREGIVER_STATUSES,
  VERIFIED_CAREGIVER_STATUSES,
  careTypeValues,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  caregivers,
  caregiverSkills,
  skills,
  caregiverLanguages,
  languages,
  preferredLocations,
  cities,
  districts,
  availability,
  qualifications,
  experiences,
  bookingShifts,
  CARE_TYPE_COLUMNS,
} from '../database/schema';
import { SearchRequestDto } from './dto/search-request.dto';
import { RankingService, type RankedCandidate, type RankingCandidate } from './ranking/ranking.service';
import { GeoService, localName } from '../geo/geo.service';

/** Hard cap on how many hard-filter matches we ever pull into memory to
 * score - independent of the page size the caller asked for. Bounds both
 * the query cost and the AI candidate-pool size later. See architecture
 * P (pagination / result caps as enumeration & abuse protection). */
const MAX_CANDIDATE_POOL = 500;

const NONE = sql`1 = 0`;

/** Listed in public search: Registered onwards, never Draft, Inactive, Suspended or Rejected. */
const isPubliclyListed = () => and(isNull(caregivers.deletedAt), inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]));
const PUBLIC_STATUS_SET = new Set<string>(PUBLIC_CAREGIVER_STATUSES);
const VERIFIED_STATUS_SET = new Set<string>(VERIFIED_CAREGIVER_STATUSES);

/** Picks the requested language's city name from a three-column row. */
function pick(row: { nameEn: string; nameSi: string; nameTa: string }, locale: Locale): string {
  return locale === 'si' ? row.nameSi : locale === 'ta' ? row.nameTa : row.nameEn;
}

/** Same as pick(), for the own-location join whose columns are prefixed. */
function pickOwnCity(
  row: { cityEn: string | null; citySi: string | null; cityTa: string | null },
  locale: Locale,
): string | null {
  const value = locale === 'si' ? row.citySi : locale === 'ta' ? row.cityTa : row.cityEn;
  return value ?? row.cityEn;
}

function pickDistrict(
  row: { districtEn: string | null; districtSi: string | null; districtTa: string | null },
  locale: Locale,
): string | null {
  const value = locale === 'si' ? row.districtSi : locale === 'ta' ? row.districtTa : row.districtEn;
  return value ?? row.districtEn;
}

type PoolRow = {
  id: string;
  publicId: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth: Date;
  districtId: number | null;
  cityId: number | null;
  status: string;
};

/** Where a search measures distances from, after choosing between the candidates for it. */
export interface ResolvedOrigin extends GeoPoint {
  source: OriginSource;
  label: string | null;
  radiusKm: number;
  /** The searched district, when the origin is only its centre (see resolveLocationFilterIds). */
  districtId: number | null;
}

/** A ranked candidate pool plus what is needed to render any of it. */
export interface RankedPool {
  ranked: RankedCandidate[];
  rows: Map<string, PoolRow>;
  enriched: Map<string, EnrichedCandidate>;
  origin: ResolvedOrigin | null;
  /** The whole pool grouped by where each caregiver lives - counts only, never ids. */
  mapPoints: MapCityPoint[];
}

const EMPTY_POOL = (origin: ResolvedOrigin | null): RankedPool => ({ ranked: [], rows: new Map(), enriched: new Map(), origin, mapPoints: [] });

export interface EnrichedCandidate {
  skills: { id: string; name: string }[];
  languages: { name: string; proficiency: string }[];
  preferredLocationCities: string[];
  preferredLocationCityIds: number[];
  preferredLocationDistrictIds: number[];
  districtName: string | null;
  cityName: string | null;
  homeLocation: CaregiverHomeLocation | null;
  /** Key of the map point this caregiver is counted under (`c<cityId>` / `d<districtId>`). */
  homeKey: string | null;
  homeDistanceKm: number | null;
  serviceArea: ServiceAreaCity[];
  nearestServiceCity: { name: string; distanceKm: number } | null;
  reach: 'home' | 'serviceArea' | null;
  matchedOptionalSkillCount: number;
  matchedLanguageCount: number;
  matchedConditionCount: number;
  yearsOfRelevantExperience: number;
  hasVerifiedQualification: boolean;
  qualificationSummary: string[];
  relevantExperienceSummary: string[];
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  preferredShift: string;
  availableFrom: string | null;
  careTypes: CareType[];
}

function approxAgeBand(dateOfBirth: Date): number {
  const ageYears = Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  // Rounded to the nearest 5 years so this is never precise enough to help
  // identify someone - "42 years" in the brief's own example is itself an
  // approximation, not the literal computed age.
  return Math.max(18, Math.round(ageYears / 5) * 5);
}

@Injectable()
export class PublicSearchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ranking: RankingService,
    private readonly geo: GeoService,
  ) {}

  /** Caregiver IDs that have ALL of the given skill IDs - mirrors
   * CaregiversService.caregiverIdsWithAllSkills so both search surfaces
   * share the same AND-matching semantics for "mandatory" skills. */
  private async caregiverIdsWithAllSkills(skillIds: string[]): Promise<string[]> {
    if (!skillIds.length) return [];
    const rows = await this.db
      .select({ caregiverId: caregiverSkills.caregiverId })
      .from(caregiverSkills)
      .where(inArray(caregiverSkills.skillId, skillIds))
      .groupBy(caregiverSkills.caregiverId)
      .having(sql`count(distinct ${caregiverSkills.skillId}) = ${skillIds.length}`);
    return rows.map((r) => r.caregiverId);
  }

  /**
   * Where this search measures distances from. In order of preference:
   *  1. the visitor's device ("Use my location") - only if it is near a city
   *     the platform knows, so a wrong or foreign reading is ignored, not used;
   *  2. the searched city;
   *  3. the signed-in client's profile city - only if it lies in the searched
   *     district, so searching Galle for a parent while living in Colombo does
   *     not measure from Colombo;
   *  4. the centre of the searched district.
   * Null when the request names no location the reference data knows.
   */
  async resolveOrigin(request: SearchRequestDto): Promise<ResolvedOrigin | null> {
    const locale = resolveLocale(request.locale);
    const radiusKm = request.radiusKm ?? DEFAULT_SEARCH_RADIUS_KM;
    const searchedDistrictId = request.location?.districtId ?? null;
    const base = { radiusKm, districtId: null };

    const { latitude, longitude } = request.origin ?? {};
    if (typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const nearest = await this.geo.nearestCity({ latitude, longitude }, locale);
      if (nearest && nearest.distanceKm <= MAX_DEVICE_DISTANCE_FROM_CITY_KM) {
        return { ...base, latitude, longitude, source: 'device', label: nearest.name };
      }
    }

    const searchCity = await this.geo.city(request.location?.cityId);
    if (searchCity) return { ...base, latitude: searchCity.latitude, longitude: searchCity.longitude, source: 'searchCity', label: localName(searchCity, locale) };

    const profileCity = await this.geo.city(request.origin?.cityId);
    if (profileCity && (!searchedDistrictId || profileCity.districtId === searchedDistrictId)) {
      return { ...base, latitude: profileCity.latitude, longitude: profileCity.longitude, source: 'profileCity', label: localName(profileCity, locale) };
    }

    const district = await this.geo.district(searchedDistrictId);
    if (district) {
      return { ...base, latitude: district.latitude, longitude: district.longitude, source: 'district', label: localName(district, locale), districtId: district.id };
    }
    return null;
  }

  /**
   * Caregiver ids within reach of the origin: those who live within the
   * radius, and those who list a preferred work city within it.
   *
   * A caregiver with no city on record is placed at their district's centre.
   * When the origin is itself only a district centre (no city to measure
   * from), everyone based in - or travelling to - that district also counts,
   * as it did before distances existed: a big district's far corner is still
   * "in the district" the visitor asked for.
   *
   * Returns null for "no location filter at all", which the caller treats
   * differently from an empty array - an empty array means the filter was
   * applied and matched nobody, which has to collapse the result set rather
   * than silently returning everyone.
   */
  private async resolveLocationFilterIds(origin: ResolvedOrigin | null): Promise<string[] | null> {
    if (!origin) return null;

    const [cityIds, districtIds] = await Promise.all([
      this.geo.cityIdsWithin(origin, origin.radiusKm),
      this.geo.districtIdsWithin(origin, origin.radiusKm),
    ]);
    let preferredCityIds = cityIds;
    if (origin.districtId) {
      const { cities: all } = await this.geo.all();
      const inDistrict = [...all.values()].filter((c) => c.districtId === origin.districtId).map((c) => c.id);
      preferredCityIds = [...new Set([...cityIds, ...inDistrict])];
    }

    const ownConditions = [
      cityIds.length ? inArray(caregivers.cityId, cityIds) : null,
      districtIds.length ? and(isNull(caregivers.cityId), inArray(caregivers.districtId, districtIds)) : null,
      origin.districtId ? eq(caregivers.districtId, origin.districtId) : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined);

    const [ownMatches, preferredMatches] = await Promise.all([
      ownConditions.length ? this.db.select({ id: caregivers.id }).from(caregivers).where(or(...ownConditions)) : Promise.resolve([]),
      preferredCityIds.length
        ? this.db
            .selectDistinct({ caregiverId: preferredLocations.caregiverId })
            .from(preferredLocations)
            .where(inArray(preferredLocations.cityId, preferredCityIds))
        : Promise.resolve([]),
    ]);

    return [...new Set([...preferredMatches.map((r) => r.caregiverId), ...ownMatches.map((r) => r.id)])];
  }

  async search(request: SearchRequestDto): Promise<PublicSearchResponse> {
    const pool = await this.rankedPool(request);
    return this.toPage(pool, request);
  }

  /**
   * The whole hard-filtered, deterministically ranked candidate pool for a
   * request - what Normal Search pages through, and what the AI features take
   * their (bounded) slice from to re-rank. Never touches a model itself.
   */
  async rankedPool(request: SearchRequestDto): Promise<RankedPool> {
    const conditions = [isPubliclyListed()];

    // Care type is a hard filter: leave out caregivers who have switched it
    // off. Someone with no availability record yet has not narrowed anything
    // down, so they stay in - the same as the column defaults (all on).
    if (request.careType) {
      const column = availability[CARE_TYPE_COLUMNS[request.careType]];
      const declined = await this.db.select({ caregiverId: availability.caregiverId }).from(availability).where(eq(column, false));
      if (declined.length) conditions.push(notInArray(caregivers.id, declined.map((d) => d.caregiverId)));
    }

    if (request.mandatorySkillIds?.length) {
      const matches = await this.caregiverIdsWithAllSkills(request.mandatorySkillIds);
      conditions.push(matches.length ? inArray(caregivers.id, matches) : NONE);
    }

    const origin = await this.resolveOrigin(request);
    const locationMatches = await this.resolveLocationFilterIds(origin);
    if (locationMatches !== null) {
      conditions.push(locationMatches.length ? inArray(caregivers.id, locationMatches) : NONE);
    } else if (request.location?.districtId || request.location?.cityId) {
      // A location was asked for but none of it exists in the reference data:
      // that is "nobody matches", not "no filter".
      conditions.push(NONE);
    }

    if (request.minimumExperienceYears) {
      // Experience is tracked per experiences row, not as a single number on
      // caregivers - approximate "has at least N years somewhere" via a
      // date-range check rather than summing rows, which is a reasonable
      // phase-1 simplification (see risks in the written-up plan).
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - request.minimumExperienceYears);
      const rows = await this.db
        .selectDistinct({ caregiverId: experiences.caregiverId })
        .from(experiences)
        .where(sql`${experiences.startDate} <= ${cutoff.toISOString().slice(0, 10)}`);
      const matches = rows.map((r) => r.caregiverId);
      conditions.push(matches.length ? inArray(caregivers.id, matches) : NONE);
    }

    // Someone already booked that day is not available to start then: drop
    // caregivers holding a confirmed shift on the desired start date (Colombo).
    if (request.desiredStartDate && isValidDate(request.desiredStartDate.slice(0, 10))) {
      const day = request.desiredStartDate.slice(0, 10);
      const booked = await this.db
        .selectDistinct({ caregiverId: bookingShifts.caregiverId })
        .from(bookingShifts)
        .where(
          and(
            eq(bookingShifts.status, 'SCHEDULED'),
            lt(bookingShifts.startsAt, colomboToUtc(addDays(day, 1), '00:00')),
            gt(bookingShifts.endsAt, colomboToUtc(day, '00:00')),
          ),
        );
      if (booked.length) conditions.push(notInArray(caregivers.id, booked.map((b) => b.caregiverId)));
    }

    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        id: caregivers.id,
        publicId: caregivers.publicId,
        gender: caregivers.gender,
        dateOfBirth: caregivers.dateOfBirth,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
        status: caregivers.status,
      })
      .from(caregivers)
      .where(whereClause)
      .limit(MAX_CANDIDATE_POOL);

    if (!rows.length) return EMPTY_POOL(origin);

    const candidateIds = rows.map((r) => r.id);
    const enriched = await this.enrichCandidates(candidateIds, request, origin);

    const rankingInputs: RankingCandidate[] = rows.map((row) => {
      const e = enriched.get(row.id)!;
      return {
        caregiverId: row.id,
        districtName: e.districtName,
        cityName: e.cityName,
        homeDistanceKm: e.homeDistanceKm,
        nearestServiceCity: e.nearestServiceCity,
        reach: e.reach,
        gender: row.gender,
        matchedOptionalSkillCount: e.matchedOptionalSkillCount,
        matchedLanguageCount: e.matchedLanguageCount,
        matchedConditionCount: e.matchedConditionCount,
        yearsOfRelevantExperience: e.yearsOfRelevantExperience,
        hasVerifiedQualification: e.hasVerifiedQualification,
        verified: VERIFIED_STATUS_SET.has(row.status),
        dayDuty: e.dayDuty,
        nightDuty: e.nightDuty,
        liveIn24h: e.liveIn24h,
      };
    });

    const ranked = this.ranking.rankAll(rankingInputs, request, { radiusKm: origin?.radiusKm ?? null });
    return { ranked, rows: new Map(rows.map((r) => [r.id, r])), enriched, origin, mapPoints: this.mapPointsOf(enriched) };
  }

  /** The pool grouped by where each caregiver lives, nearest first. Counts only - no caregiver ids leave here. */
  private mapPointsOf(enriched: Map<string, EnrichedCandidate>): MapCityPoint[] {
    const points = new Map<string, MapCityPoint>();
    for (const e of enriched.values()) {
      if (!e.homeLocation || !e.homeKey) continue;
      const point = points.get(e.homeKey);
      if (point) {
        point.count += 1;
        continue;
      }
      points.set(e.homeKey, {
        key: e.homeKey,
        latitude: e.homeLocation.latitude,
        longitude: e.homeLocation.longitude,
        precision: e.homeLocation.precision,
        name: e.homeLocation.precision === 'city' ? e.cityName : e.districtName,
        distanceKm: e.homeDistanceKm,
        count: 1,
      });
    }
    return [...points.values()].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  /** The origin as the response shows it. */
  private originOf(origin: ResolvedOrigin | null): SearchOrigin | null {
    if (!origin) return null;
    const { districtId, ...shown } = origin;
    return shown;
  }

  /**
   * One page of a pool, as public summaries. `order` (caregiver ids) replaces
   * the deterministic order when the AI re-ranked it; `aiReasons` adds the
   * model's one-line explanation to the cards it covers.
   */
  toPage(pool: RankedPool, request: SearchRequestDto, ai?: { order: string[]; reasons: Map<string, string> }): PublicSearchResponse {
    const byId = new Map(pool.ranked.map((r) => [r.caregiverId, r]));
    const ordered = ai ? ai.order.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)) : pool.ranked;
    const total = ordered.length;
    const geo = { origin: this.originOf(pool.origin), mapPoints: pool.mapPoints };
    if (!total) return { items: [], page: request.page, pageSize: request.pageSize, total: 0, totalPages: 0, ...geo };

    const start = (request.page - 1) * request.pageSize;
    const items: PublicCaregiverSummary[] = ordered.slice(start, start + request.pageSize).map((r) => {
      const summary = this.toSummary(pool.rows.get(r.caregiverId)!, pool.enriched.get(r.caregiverId)!, r.score, r.reasons);
      const aiReason = ai?.reasons.get(r.caregiverId);
      return aiReason ? { ...summary, aiReason } : summary;
    });

    return { items, page: request.page, pageSize: request.pageSize, total, totalPages: Math.ceil(total / request.pageSize), ...geo };
  }

  /** The public summary of one pooled candidate - what the AI is allowed to see about them. */
  summaryOf(pool: RankedPool, caregiverId: string): PublicCaregiverSummary | null {
    const row = pool.rows.get(caregiverId);
    const e = pool.enriched.get(caregiverId);
    const r = pool.ranked.find((x) => x.caregiverId === caregiverId);
    return row && e && r ? this.toSummary(row, e, r.score, r.reasons) : null;
  }

  async findByPublicId(publicId: string, locale?: string): Promise<PublicCaregiverProfile> {
    const [row] = await this.db
      .select({
        id: caregivers.id,
        publicId: caregivers.publicId,
        gender: caregivers.gender,
        dateOfBirth: caregivers.dateOfBirth,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
        status: caregivers.status,
        deletedAt: caregivers.deletedAt,
      })
      .from(caregivers)
      .where(eq(caregivers.publicId, publicId))
      .limit(1);

    // Same 404 whether the publicId doesn't exist or exists but isn't
    // publicly visible (wrong status, deleted) - never confirm which, to
    // avoid leaking which IDs correspond to a real (if non-public) record.
    if (!row || row.deletedAt || !PUBLIC_STATUS_SET.has(row.status)) {
      throw new NotFoundException('Caregiver not found');
    }

    // A profile page has no request locale of its own, so the visitor's
    // language arrives as a query parameter. resolveLocale makes an
    // unrecognised one English rather than a query for a column that isn't there.
    const enriched = await this.enrichCandidates([row.id], {
      locale: resolveLocale(locale),
    } as SearchRequestDto);
    const e = enriched.get(row.id)!;
    const { matchScore, matchReasons, reach, ...profile } = this.toSummary(row, e, 0, []);
    return profile;
  }

  /**
   * Public profiles for a set of caregivers, keyed by internal id - for the
   * signed-in client's saved list and requests, which hold internal ids but
   * may only ever show the anonymous public view.
   *
   * Applies exactly the visibility rule search and findByPublicId use (listed
   * status, not deleted): a caregiver who has since been suspended or removed is simply
   * absent from the map, and the caller shows them as "no longer available".
   */
  async profilesFor(caregiverIds: string[], locale?: string): Promise<Map<string, PublicCaregiverProfile>> {
    const result = new Map<string, PublicCaregiverProfile>();
    const ids = [...new Set(caregiverIds)];
    if (!ids.length) return result;

    const rows = await this.db
      .select({
        id: caregivers.id,
        publicId: caregivers.publicId,
        gender: caregivers.gender,
        dateOfBirth: caregivers.dateOfBirth,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
        status: caregivers.status,
      })
      .from(caregivers)
      .where(and(inArray(caregivers.id, ids), isPubliclyListed()));
    if (!rows.length) return result;

    const enriched = await this.enrichCandidates(
      rows.map((r) => r.id),
      { locale: resolveLocale(locale) } as SearchRequestDto,
    );
    for (const row of rows) {
      const e = enriched.get(row.id);
      if (!e) continue;
      const { matchScore, matchReasons, reach, ...profile } = this.toSummary(row, e, 0, []);
      result.set(row.id, profile);
    }
    return result;
  }

  /** Fetches everything ranking + the public DTO need for a set of
   * caregiver IDs, batched (never N+1). */
  private async enrichCandidates(
    caregiverIds: string[],
    request: SearchRequestDto,
    origin: ResolvedOrigin | null = null,
  ): Promise<Map<string, EnrichedCandidate>> {
    const locale = resolveLocale(request.locale);
    const optionalSkillIds = request.optionalSkillIds ?? [];
    const requestedLanguageIds = request.languageIds ?? [];
    const conditions = request.patient?.medicalConditions ?? [];

    const [skillRows, languageRows, locationRows, availabilityRows, qualificationRows, experienceRows, ownLocationRows] = await Promise.all([
      this.db
        .select({
          caregiverId: caregiverSkills.caregiverId,
          skillId: caregiverSkills.skillId,
          skillName: skills.name,
          yearsOfExperience: caregiverSkills.yearsOfExperience,
        })
        .from(caregiverSkills)
        .innerJoin(skills, eq(caregiverSkills.skillId, skills.id))
        .where(inArray(caregiverSkills.caregiverId, caregiverIds)),
      this.db
        .select({
          caregiverId: caregiverLanguages.caregiverId,
          languageId: caregiverLanguages.languageId,
          languageName: languages.name,
          proficiency: caregiverLanguages.proficiency,
        })
        .from(caregiverLanguages)
        .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
        .where(inArray(caregiverLanguages.caregiverId, caregiverIds)),
      this.db
        .select({
          caregiverId: preferredLocations.caregiverId,
          cityId: cities.id,
          districtId: cities.districtId,
          nameEn: cities.nameEn,
          nameSi: cities.nameSi,
          nameTa: cities.nameTa,
        })
        .from(preferredLocations)
        .innerJoin(cities, eq(preferredLocations.cityId, cities.id))
        .where(inArray(preferredLocations.caregiverId, caregiverIds)),
      this.db.select().from(availability).where(inArray(availability.caregiverId, caregiverIds)),
      this.db
        .select({
          caregiverId: qualifications.caregiverId,
          name: qualifications.name,
          institution: qualifications.institution,
          verificationStatus: qualifications.verificationStatus,
        })
        .from(qualifications)
        .where(inArray(qualifications.caregiverId, caregiverIds)),
      this.db
        .select({
          caregiverId: experiences.caregiverId,
          careType: experiences.careType,
          patientCategory: experiences.patientCategory,
          startDate: experiences.startDate,
          endDate: experiences.endDate,
        })
        .from(experiences)
        .where(inArray(experiences.caregiverId, caregiverIds)),
      // The caregiver's own district/city, joined out to the reference tables
      // so the response can name them in the visitor's language. The cache
      // columns on `caregivers` hold English and are for staff, not the site.
      this.db
        .select({
          caregiverId: caregivers.id,
          cityId: caregivers.cityId,
          districtId: caregivers.districtId,
          cityEn: cities.nameEn,
          citySi: cities.nameSi,
          cityTa: cities.nameTa,
          districtEn: districts.nameEn,
          districtSi: districts.nameSi,
          districtTa: districts.nameTa,
        })
        .from(caregivers)
        .leftJoin(cities, eq(caregivers.cityId, cities.id))
        .leftJoin(districts, eq(caregivers.districtId, districts.id))
        .where(inArray(caregivers.id, caregiverIds)),
    ]);

    const ownRows = new Map(ownLocationRows.map((r) => [r.caregiverId, r]));
    const places = await this.geo.all();
    const distanceTo = (point: GeoPoint | null) => (origin && point ? roundKm(haversineKm(origin, point)) : null);

    const result = new Map<string, EnrichedCandidate>();

    for (const id of caregiverIds) {
      const mySkills = skillRows.filter((s) => s.caregiverId === id);
      const myLanguages = languageRows.filter((l) => l.caregiverId === id);
      const myLocations = locationRows.filter((l) => l.caregiverId === id);
      const myOwn = ownRows.get(id);
      const myAvailability = availabilityRows.find((a) => a.caregiverId === id);
      const myQualifications = qualificationRows.filter((q) => q.caregiverId === id);
      const myExperiences = experienceRows.filter((e) => e.caregiverId === id);

      const matchedOptionalSkillCount = mySkills.filter((s) => optionalSkillIds.includes(s.skillId)).length;
      const matchedLanguageCount = myLanguages.filter((l) => requestedLanguageIds.includes(l.languageId)).length;
      const matchedConditionCount = conditions.filter((condition) => {
        const needle = condition.toLowerCase();
        return (
          mySkills.some((s) => s.skillName.toLowerCase().includes(needle) || needle.includes(s.skillName.toLowerCase())) ||
          myExperiences.some((e) => (e.careType ?? '').toLowerCase().includes(needle))
        );
      }).length;

      const totalYears = mySkills.reduce((sum, s) => sum + (s.yearsOfExperience ?? 0), 0);
      const hasVerifiedQualification = myQualifications.some((q) => q.verificationStatus === 'VERIFIED');

      // City-level only: the centre of the city they live in, or of their
      // district when no city is on record. Never anything finer.
      const homeCity = myOwn?.cityId ? places.cities.get(myOwn.cityId) : undefined;
      const homeDistrict = !homeCity && myOwn?.districtId ? places.districts.get(myOwn.districtId) : undefined;
      const homeLocation: CaregiverHomeLocation | null = homeCity
        ? { latitude: homeCity.latitude, longitude: homeCity.longitude, precision: 'city' }
        : homeDistrict
          ? { latitude: homeDistrict.latitude, longitude: homeDistrict.longitude, precision: 'district' }
          : null;
      const homeKey = homeCity ? `c${homeCity.id}` : homeDistrict ? `d${homeDistrict.id}` : null;
      const homeDistanceKm = distanceTo(homeLocation);

      const serviceArea: ServiceAreaCity[] = myLocations.flatMap((l) => {
        const point = places.cities.get(l.cityId);
        return point
          ? [{ cityId: l.cityId, name: pick(l, locale), latitude: point.latitude, longitude: point.longitude, distanceKm: distanceTo(point) }]
          : [];
      });
      const nearestService = serviceArea
        .filter((c): c is ServiceAreaCity & { distanceKm: number } => c.distanceKm !== null)
        .sort((a, b) => a.distanceKm - b.distanceKm)[0];

      let reach: EnrichedCandidate['reach'] = null;
      if (origin) {
        if (homeDistanceKm !== null && homeDistanceKm <= origin.radiusKm) reach = 'home';
        else if (nearestService && nearestService.distanceKm <= origin.radiusKm) reach = 'serviceArea';
        else if (origin.districtId && myOwn?.districtId === origin.districtId) reach = 'home';
        else if (origin.districtId && myLocations.some((l) => l.districtId === origin.districtId)) reach = 'serviceArea';
      }

      result.set(id, {
        skills: mySkills.map((s) => ({ id: s.skillId, name: s.skillName })),
        languages: myLanguages.map((l) => ({ name: l.languageName, proficiency: l.proficiency })),
        preferredLocationCities: myLocations.map((l) => pick(l, locale)),
        preferredLocationCityIds: myLocations.map((l) => l.cityId),
        preferredLocationDistrictIds: [...new Set(myLocations.map((l) => l.districtId))],
        districtName: myOwn ? pickDistrict(myOwn, locale) : null,
        cityName: myOwn?.cityId ? pickOwnCity(myOwn, locale) : null,
        homeLocation,
        homeKey,
        homeDistanceKm,
        serviceArea,
        nearestServiceCity: nearestService ? { name: nearestService.name, distanceKm: nearestService.distanceKm } : null,
        reach,
        matchedOptionalSkillCount,
        matchedLanguageCount,
        matchedConditionCount,
        yearsOfRelevantExperience: totalYears,
        hasVerifiedQualification,
        // Institution name is explicitly OK to show publicly (confirmed
        // design decision) - qualifications the caregiver has actually
        // submitted, verified or not, are shown; only internal
        // verification *notes* stay hidden, never the qualification itself.
        qualificationSummary: myQualifications.map((q) => `${q.name} — ${q.institution}`),
        relevantExperienceSummary: [
          ...new Set(myExperiences.map((e) => e.careType).filter((c): c is string => !!c)),
        ],
        dayDuty: myAvailability?.dayDuty ?? false,
        nightDuty: myAvailability?.nightDuty ?? false,
        liveIn24h: myAvailability?.liveIn24h ?? false,
        preferredShift: myAvailability?.preferredShift ?? 'FLEXIBLE',
        availableFrom: myAvailability?.availableFrom ? String(myAvailability.availableFrom) : null,
        careTypes: careTypeValues.filter((type) => (myAvailability ? myAvailability[CARE_TYPE_COLUMNS[type]] : true)),
      });
    }

    return result;
  }

  private toSummary(
    row: {
      publicId: string;
      gender: 'MALE' | 'FEMALE' | 'OTHER';
      dateOfBirth: Date;
      districtId: number | null;
      cityId: number | null;
      status: string;
    },
    enriched: EnrichedCandidate,
    score: number,
    reasons: string[],
  ): PublicCaregiverSummary {
    return {
      publicId: row.publicId,
      gender: row.gender,
      approxAge: approxAgeBand(row.dateOfBirth),
      yearsExperience: enriched.yearsOfRelevantExperience,
      district: enriched.districtName,
      city: enriched.cityName,
      districtId: row.districtId,
      cityId: row.cityId,
      preferredLocations: enriched.preferredLocationCities,
      languages: enriched.languages,
      skills: enriched.skills,
      availability: {
        dayDuty: enriched.dayDuty,
        nightDuty: enriched.nightDuty,
        liveIn24h: enriched.liveIn24h,
        preferredShift: enriched.preferredShift as never,
        availableFrom: enriched.availableFrom,
      },
      hasVerifiedQualification: enriched.hasVerifiedQualification,
      verified: VERIFIED_STATUS_SET.has(row.status),
      careTypes: enriched.careTypes,
      qualificationSummary: enriched.qualificationSummary,
      relevantExperienceSummary: enriched.relevantExperienceSummary,
      homeLocation: enriched.homeLocation,
      distanceKm: enriched.homeDistanceKm,
      serviceArea: enriched.serviceArea,
      reach: enriched.reach,
      matchScore: score,
      matchReasons: reasons,
    };
  }
}
