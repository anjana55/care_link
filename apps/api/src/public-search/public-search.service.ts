import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PublicCaregiverProfile, PublicCaregiverSummary, PublicSearchResponse } from '@care-platform/shared';
import { resolveLocale, type Locale } from '@care-platform/shared';
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
} from '../database/schema';
import { SearchRequestDto } from './dto/search-request.dto';
import { RankingService, type LocationLabels, type RankingCandidate } from './ranking/ranking.service';

/** Hard cap on how many hard-filter matches we ever pull into memory to
 * score - independent of the page size the caller asked for. Bounds both
 * the query cost and the AI candidate-pool size later. See architecture
 * P (pagination / result caps as enumeration & abuse protection). */
const MAX_CANDIDATE_POOL = 500;

const NONE = sql`1 = 0`;

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
   * Caregiver ids matching a district and/or city, by id.
   *
   * Returns null for "no location filter at all", which the caller treats
   * differently from an empty array - an empty array means the filter was
   * applied and matched nobody, which has to collapse the result set rather
   * than silently returning everyone.
   */
  private async resolveLocationFilterIds(cityId?: number, districtId?: number): Promise<string[] | null> {
    if (!cityId && !districtId) return null;

    const ownConditions = [
      cityId ? eq(caregivers.cityId, cityId) : null,
      districtId ? eq(caregivers.districtId, districtId) : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const ownMatches = await this.db
      .select({ id: caregivers.id })
      .from(caregivers)
      .where(or(...ownConditions));

    // A caregiver who lists a searched city as a preferred work location counts
    // too, not only one whose own record names it.
    const preferredMatches = cityId
      ? (
          await this.db
            .selectDistinct({ caregiverId: preferredLocations.caregiverId })
            .from(preferredLocations)
            .where(eq(preferredLocations.cityId, cityId))
        ).map((r) => r.caregiverId)
      : [];

    return [...new Set([...preferredMatches, ...ownMatches.map((r) => r.id)])];
  }

  async search(request: SearchRequestDto): Promise<PublicSearchResponse> {
    const conditions = [isNull(caregivers.deletedAt), eq(caregivers.status, 'ACTIVE')];

    if (request.mandatorySkillIds?.length) {
      const matches = await this.caregiverIdsWithAllSkills(request.mandatorySkillIds);
      conditions.push(matches.length ? inArray(caregivers.id, matches) : NONE);
    }

    const locationMatches = await this.resolveLocationFilterIds(request.location?.cityId, request.location?.districtId);
    if (locationMatches !== null) {
      conditions.push(locationMatches.length ? inArray(caregivers.id, locationMatches) : NONE);
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

    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        id: caregivers.id,
        publicId: caregivers.publicId,
        gender: caregivers.gender,
        dateOfBirth: caregivers.dateOfBirth,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
      })
      .from(caregivers)
      .where(whereClause)
      .limit(MAX_CANDIDATE_POOL);

    if (!rows.length) {
      return { items: [], page: request.page, pageSize: request.pageSize, total: 0, totalPages: 0 };
    }

    const candidateIds = rows.map((r) => r.id);
    const enriched = await this.enrichCandidates(candidateIds, request);

    const rankingInputs: RankingCandidate[] = rows.map((row) => {
      const e = enriched.get(row.id)!;
      return {
        caregiverId: row.id,
        districtId: row.districtId,
        cityId: row.cityId,
        preferredLocationCityIds: e.preferredLocationCityIds,
        preferredLocationDistrictIds: e.preferredLocationDistrictIds,
        districtName: e.districtName,
        cityName: e.cityName,
        gender: row.gender,
        matchedOptionalSkillCount: e.matchedOptionalSkillCount,
        matchedLanguageCount: e.matchedLanguageCount,
        matchedConditionCount: e.matchedConditionCount,
        yearsOfRelevantExperience: e.yearsOfRelevantExperience,
        hasVerifiedQualification: e.hasVerifiedQualification,
        dayDuty: e.dayDuty,
        nightDuty: e.nightDuty,
        liveIn24h: e.liveIn24h,
        expectedDailyRate: e.expectedDailyRate,
        expectedMonthlyRate: e.expectedMonthlyRate,
      };
    });

    const ranked = this.ranking.rankAll(rankingInputs, request, await this.locationLabels(request));
    const total = ranked.length;
    const start = (request.page - 1) * request.pageSize;
    const pageOfRanked = ranked.slice(start, start + request.pageSize);

    const rowsById = new Map(rows.map((r) => [r.id, r]));
    const items: PublicCaregiverSummary[] = pageOfRanked.map((r) => {
      const row = rowsById.get(r.caregiverId)!;
      const e = enriched.get(r.caregiverId)!;
      return this.toSummary(row, e, r.score, r.reasons);
    });

    return {
      items,
      page: request.page,
      pageSize: request.pageSize,
      total,
      totalPages: Math.ceil(total / request.pageSize),
    };
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
    if (!row || row.deletedAt || row.status !== 'ACTIVE') {
      throw new NotFoundException('Caregiver not found');
    }

    // A profile page has no request locale of its own, so the visitor's
    // language arrives as a query parameter. resolveLocale makes an
    // unrecognised one English rather than a query for a column that isn't there.
    const enriched = await this.enrichCandidates([row.id], {
      locale: resolveLocale(locale),
    } as SearchRequestDto);
    const e = enriched.get(row.id)!;
    const { matchScore, matchReasons, ...profile } = this.toSummary(row, e, 0, []);
    return profile;
  }

  /**
   * The names behind the requested location ids, so a match reason can say
   * "based in Dehiwala" rather than "based in 340". Resolved once per search
   * rather than per candidate - it is the same answer every time.
   */
  private async locationLabels(request: SearchRequestDto): Promise<LocationLabels> {
    const locale = resolveLocale(request.locale);
    const [city, district] = await Promise.all([
      request.location?.cityId
        ? this.db.select({ nameEn: cities.nameEn, nameSi: cities.nameSi, nameTa: cities.nameTa }).from(cities).where(eq(cities.id, request.location.cityId)).limit(1)
        : Promise.resolve([]),
      request.location?.districtId
        ? this.db.select({ nameEn: districts.nameEn, nameSi: districts.nameSi, nameTa: districts.nameTa }).from(districts).where(eq(districts.id, request.location.districtId)).limit(1)
        : Promise.resolve([]),
    ]);
    return { city: city[0] ? pick(city[0], locale) : null, district: district[0] ? pick(district[0], locale) : null };
  }

  /** Fetches everything ranking + the public DTO need for a set of
   * caregiver IDs, batched (never N+1). */
  private async enrichCandidates(caregiverIds: string[], request: SearchRequestDto) {
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

    const result = new Map<
      string,
      {
        skills: { id: string; name: string }[];
        languages: { name: string; proficiency: string }[];
        preferredLocationCities: string[];
        preferredLocationCityIds: number[];
        preferredLocationDistrictIds: number[];
        districtName: string | null;
        cityName: string | null;
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
        expectedDailyRate: number | null;
        expectedMonthlyRate: number | null;
      }
    >();

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

      result.set(id, {
        skills: mySkills.map((s) => ({ id: s.skillId, name: s.skillName })),
        languages: myLanguages.map((l) => ({ name: l.languageName, proficiency: l.proficiency })),
        preferredLocationCities: myLocations.map((l) => pick(l, locale)),
        preferredLocationCityIds: myLocations.map((l) => l.cityId),
        preferredLocationDistrictIds: [...new Set(myLocations.map((l) => l.districtId))],
        districtName: myOwn ? pickDistrict(myOwn, locale) : null,
        cityName: myOwn?.cityId ? pickOwnCity(myOwn, locale) : null,
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
        expectedDailyRate: myAvailability?.expectedDailyRate ? Number(myAvailability.expectedDailyRate) : null,
        expectedMonthlyRate: myAvailability?.expectedMonthlyRate ? Number(myAvailability.expectedMonthlyRate) : null,
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
    },
    enriched: Awaited<ReturnType<PublicSearchService['enrichCandidates']>> extends Map<string, infer V> ? V : never,
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
      qualificationSummary: enriched.qualificationSummary,
      relevantExperienceSummary: enriched.relevantExperienceSummary,
      matchScore: score,
      matchReasons: reasons,
    };
  }
}
