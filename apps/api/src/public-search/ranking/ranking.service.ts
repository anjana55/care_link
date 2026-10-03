import { Injectable } from '@nestjs/common';
import type { SearchRequestDto } from '../dto/search-request.dto';

/**
 * The names behind the requested location ids, for the human-readable match
 * reasons. Ids decide *whether* a caregiver matches; these only decide what the
 * reason line says, so they are passed in already resolved rather than looked
 * up per candidate.
 */
export interface LocationLabels {
  district: string | null;
  city: string | null;
}

/**
 * Everything a candidate needs to be scored against a search request.
 * Deliberately narrow - only the fields ranking actually reads, so this
 * service can be unit-tested without touching Drizzle or the DB at all.
 */
export interface RankingCandidate {
  caregiverId: string;
  districtId: number | null;
  cityId: number | null;
  /** Ids of the districts and cities this caregiver lists as preferred work
   * locations. Compared against the request's ids directly - see
   * score() for why these are ids and not names. */
  preferredLocationCityIds: number[];
  preferredLocationDistrictIds: number[];
  districtName: string | null;
  cityName: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  matchedOptionalSkillCount: number;
  matchedLanguageCount: number;
  /** How many of the patient's stated medical conditions line up with this
   * caregiver's skills/care-type experience (e.g. "Parkinson's" -> the
   * "Parkinson's Care" skill). A soft signal only - Normal Search stays
   * deterministic text matching, no AI involved. */
  matchedConditionCount: number;
  yearsOfRelevantExperience: number;
  hasVerifiedQualification: boolean;
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  expectedDailyRate: number | null;
  expectedMonthlyRate: number | null;
}

export interface RankedCandidate {
  caregiverId: string;
  score: number;
  reasons: string[];
}

// Configurable weights - kept as constants for now (admin-configurable
// weighting is a reasonable phase-2 addition; not required for phase 1).
const WEIGHTS = {
  verifiedQualification: 25,
  optionalSkillMatch: 5,
  optionalSkillMatchCap: 20,
  languageMatch: 8,
  languageMatchCap: 24,
  experiencePerYear: 2,
  experienceCap: 20,
  conditionMatch: 12,
  conditionMatchCap: 24,
  exactCityMatch: 15,
  districtOnlyMatch: 7,
  shiftExactMatch: 10,
  genderPreferenceMatch: 5,
  budgetWithinRange: 10,
} as const;

@Injectable()
export class RankingService {
  /**
   * Pure scoring function - no I/O, no randomness, same input always
   * produces the same score and the same reasons. That determinism is the
   * whole point of "Normal Search": it must never require an AI model.
   */
  score(candidate: RankingCandidate, request: SearchRequestDto, labels: LocationLabels): RankedCandidate {
    let score = 0;
    const reasons: string[] = [];

    if (candidate.hasVerifiedQualification) {
      score += WEIGHTS.verifiedQualification;
      reasons.push('has a verified qualification');
    }

    if (request.optionalSkillIds?.length) {
      const matched = Math.min(candidate.matchedOptionalSkillCount, request.optionalSkillIds.length);
      score += Math.min(matched * WEIGHTS.optionalSkillMatch, WEIGHTS.optionalSkillMatchCap);
      if (matched > 0) reasons.push(`matches ${matched} of ${request.optionalSkillIds.length} preferred skills`);
    }

    if (request.languageIds?.length) {
      const matched = Math.min(candidate.matchedLanguageCount, request.languageIds.length);
      score += Math.min(matched * WEIGHTS.languageMatch, WEIGHTS.languageMatchCap);
      if (matched > 0) reasons.push(`speaks ${matched} of the requested language${matched > 1 ? 's' : ''}`);
    }

    if (request.patient?.medicalConditions?.length && candidate.matchedConditionCount > 0) {
      const matched = Math.min(candidate.matchedConditionCount, request.patient.medicalConditions.length);
      score += Math.min(matched * WEIGHTS.conditionMatch, WEIGHTS.conditionMatchCap);
      reasons.push(`has relevant experience with ${matched > 1 ? 'the stated conditions' : 'the stated condition'}`);
    }

    const cappedYears = Math.min(candidate.yearsOfRelevantExperience, WEIGHTS.experienceCap / WEIGHTS.experiencePerYear);
    score += cappedYears * WEIGHTS.experiencePerYear;
    if (
      request.minimumExperienceYears !== undefined &&
      candidate.yearsOfRelevantExperience >= request.minimumExperienceYears &&
      candidate.yearsOfRelevantExperience > 0
    ) {
      reasons.push(`has ${candidate.yearsOfRelevantExperience}+ years of relevant experience`);
    }

    // Id equality, not name equality. These used to be lowercased string
    // comparisons while public-search's filter matched the same fields
    // case-sensitively and untrimmed - so a caregiver could be filtered in by
    // one rule and then scored as "not in this district" by the other. Ids
    // cannot disagree with themselves.
    const requestedCityId = request.location?.cityId;
    const requestedDistrictId = request.location?.districtId;

    if (requestedCityId && candidate.cityId === requestedCityId) {
      score += WEIGHTS.exactCityMatch;
      reasons.push(`based in ${candidate.cityName ?? 'the requested city'}`);
    } else if (requestedCityId && candidate.preferredLocationCityIds.includes(requestedCityId)) {
      score += WEIGHTS.exactCityMatch;
      reasons.push(`covers ${labels.city ?? 'the requested city'} as a preferred work location`);
    } else if (
      requestedDistrictId &&
      (candidate.districtId === requestedDistrictId ||
        candidate.preferredLocationDistrictIds.includes(requestedDistrictId))
    ) {
      score += WEIGHTS.districtOnlyMatch;
      reasons.push(`works in the ${candidate.districtName ?? labels.district ?? 'requested'} district`);
    }

    if (request.shift) {
      const shiftMatches =
        (request.shift === 'DAY' && candidate.dayDuty) ||
        (request.shift === 'NIGHT' && candidate.nightDuty) ||
        (request.shift === 'TWENTY_FOUR_HOUR_LIVE_IN' && candidate.liveIn24h) ||
        request.shift === 'FLEXIBLE';
      if (shiftMatches) {
        score += WEIGHTS.shiftExactMatch;
        reasons.push('available for the requested shift');
      }
    }

    if (
      request.caregiverGenderPreference &&
      request.caregiverGenderPreference !== 'ANY' &&
      candidate.gender === request.caregiverGenderPreference
    ) {
      score += WEIGHTS.genderPreferenceMatch;
      reasons.push('matches the preferred caregiver gender');
    }

    const dailyBudget = request.budget?.dailyRate;
    const monthlyBudget = request.budget?.monthlyRate;
    if (dailyBudget !== undefined && candidate.expectedDailyRate !== null) {
      if (candidate.expectedDailyRate <= dailyBudget) {
        score += WEIGHTS.budgetWithinRange;
      } else {
        // Sliding penalty above budget - never excludes, only de-prioritizes.
        const overBy = (candidate.expectedDailyRate - dailyBudget) / dailyBudget;
        score -= Math.min(overBy * WEIGHTS.budgetWithinRange, WEIGHTS.budgetWithinRange);
      }
    } else if (monthlyBudget !== undefined && candidate.expectedMonthlyRate !== null) {
      if (candidate.expectedMonthlyRate <= monthlyBudget) {
        score += WEIGHTS.budgetWithinRange;
      } else {
        const overBy = (candidate.expectedMonthlyRate - monthlyBudget) / monthlyBudget;
        score -= Math.min(overBy * WEIGHTS.budgetWithinRange, WEIGHTS.budgetWithinRange);
      }
    }

    return { caregiverId: candidate.caregiverId, score: Math.round(score * 100) / 100, reasons };
  }

  rankAll(candidates: RankingCandidate[], request: SearchRequestDto, labels: LocationLabels): RankedCandidate[] {
    return candidates.map((c) => this.score(c, request, labels)).sort((a, b) => b.score - a.score);
  }
}
