import { Injectable } from '@nestjs/common';
import type { SearchRequestDto } from '../dto/search-request.dto';

/**
 * What ranking needs to know about the search as a whole, resolved once per
 * search rather than per candidate.
 */
export interface RankingContext {
  /** The search radius when the search had an origin to measure from; null otherwise. */
  radiusKm: number | null;
}

/**
 * Everything a candidate needs to be scored against a search request.
 * Deliberately narrow - only the fields ranking actually reads, so this
 * service can be unit-tested without touching Drizzle or the DB at all.
 */
export interface RankingCandidate {
  caregiverId: string;
  /** The caregiver's own city name, in the visitor's language, for the reason line. */
  cityName: string | null;
  districtName: string | null;
  /** Straight-line km from the search origin to where the caregiver lives. */
  homeDistanceKm: number | null;
  /** The closest of the caregiver's preferred work cities to the origin, and how far it is. */
  nearestServiceCity: { name: string; distanceKm: number } | null;
  /** Why the caregiver is in the result set at all - see PublicSearchService.reachOf. */
  reach: 'home' | 'serviceArea' | null;
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
  // Up to this many points for proximity, falling linearly from the full
  // amount at 0 km to nothing at the edge of the search radius.
  proximity: 15,
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
  score(candidate: RankingCandidate, request: SearchRequestDto, context: RankingContext): RankedCandidate {
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

    // Proximity: how close the caregiver is to the origin, measured to where
    // they live or - if that is closer - to the nearest city they travel to.
    // Membership (who is in the result set at all) is decided by the radius
    // filter in PublicSearchService; this only orders within it.
    if (context.radiusKm && candidate.reach) {
      const homeKm = candidate.homeDistanceKm;
      const serviceKm = candidate.nearestServiceCity?.distanceKm ?? null;
      const viaService = candidate.reach === 'serviceArea' || (serviceKm !== null && (homeKm === null || serviceKm < homeKm));
      const km = viaService ? serviceKm : homeKm;
      if (km !== null) {
        score += WEIGHTS.proximity * Math.max(0, 1 - km / context.radiusKm);
      }
      if (candidate.reach === 'home' && homeKm !== null) {
        reasons.push(`based in ${candidate.cityName ?? candidate.districtName ?? 'the area'}, ${homeKm} km away`);
      } else if (candidate.reach === 'home') {
        reasons.push(`based in the ${candidate.districtName ?? 'requested'} district`);
      } else if (candidate.nearestServiceCity) {
        reasons.push(`works in ${candidate.nearestServiceCity.name}, ${candidate.nearestServiceCity.distanceKm} km away`);
      }
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

  rankAll(candidates: RankingCandidate[], request: SearchRequestDto, context: RankingContext): RankedCandidate[] {
    return candidates.map((c) => this.score(c, request, context)).sort((a, b) => b.score - a.score);
  }
}
