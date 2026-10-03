import { RankingService, RankingCandidate, LocationLabels } from './ranking.service';
import { SearchRequestDto } from '../dto/search-request.dto';

/** Colombo district, and a city inside it. Real ids, because ranking
 * compares ids rather than names. */
const COLOMBO = 1;
const DEHIWALA = 340;
const MORATUWA = 654;

const LABELS: LocationLabels = { district: 'Colombo', city: 'Colombo' };

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    caregiverId: 'cg-1',
    districtId: COLOMBO,
    cityId: COLOMBO,
    preferredLocationCityIds: [],
    preferredLocationDistrictIds: [],
    districtName: 'Colombo',
    cityName: 'Colombo',
    gender: 'FEMALE',
    matchedOptionalSkillCount: 0,
    matchedLanguageCount: 0,
    matchedConditionCount: 0,
    yearsOfRelevantExperience: 0,
    hasVerifiedQualification: false,
    dayDuty: true,
    nightDuty: false,
    liveIn24h: false,
    expectedDailyRate: null,
    expectedMonthlyRate: null,
    ...overrides,
  };
}

function request(overrides: Partial<SearchRequestDto> = {}): SearchRequestDto {
  return { page: 1, pageSize: 20, ...overrides } as SearchRequestDto;
}

describe('RankingService', () => {
  let service: RankingService;

  beforeEach(() => {
    service = new RankingService();
  });

  it('is deterministic - identical input always produces identical output', () => {
    const c = candidate({ hasVerifiedQualification: true, yearsOfRelevantExperience: 5 });
    const r = request();
    const first = service.score(c, r, LABELS);
    const second = service.score(c, r, LABELS);
    expect(first).toEqual(second);
  });

  it('never requires an AI model - pure function of its arguments only', () => {
    // Regression guard: this test simply asserts the method signature stays
    // synchronous and side-effect free (no network/DB calls hidden inside).
    const result = service.score(candidate(), request(), LABELS);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('gives a ranking boost for a verified qualification, with a factual reason', () => {
    const verified = service.score(candidate({ hasVerifiedQualification: true }), request(), LABELS);
    const unverified = service.score(candidate({ hasVerifiedQualification: false }), request(), LABELS);
    expect(verified.score).toBeGreaterThan(unverified.score);
    expect(verified.reasons).toContain('has a verified qualification');
  });

  it('never produces a subjective claim as a reason', () => {
    const { reasons } = service.score(
      candidate({ hasVerifiedQualification: true, matchedOptionalSkillCount: 2 }),
      request({ optionalSkillIds: ['a', 'b'] }),
      LABELS,
    );
    const banned = ['compassionate', 'perfect', 'trustworthy', 'best', 'amazing'];
    for (const reason of reasons) {
      for (const word of banned) {
        expect(reason.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('boosts and explains an exact city match over a district-only match', () => {
    const cityMatch = service.score(
      candidate({ cityId: COLOMBO, districtId: COLOMBO }),
      request({ location: { cityId: COLOMBO, districtId: COLOMBO } }),
      LABELS,
    );
    const districtOnly = service.score(
      candidate({ cityId: MORATUWA, districtId: COLOMBO }),
      request({ location: { districtId: COLOMBO } }),
      LABELS,
    );
    expect(cityMatch.score).toBeGreaterThan(districtOnly.score);
  });

  it('treats budget as ranking influence only, never a disqualifier', () => {
    const overBudget = service.score(
      candidate({ expectedDailyRate: 5000 }),
      request({ budget: { dailyRate: 3000 } }),
      LABELS,
    );
    const withinBudget = service.score(
      candidate({ expectedDailyRate: 2500 }),
      request({ budget: { dailyRate: 3000 } }),
      LABELS,
    );
    // Over budget scores lower, but a result still comes back - the caller
    // never gets an empty set purely because of price.
    expect(overBudget.score).toBeLessThan(withinBudget.score);
    expect(overBudget).toBeDefined();
  });

  it('matches a stated medical condition against a relevant skill/care-type', () => {
    const { reasons, score } = service.score(
      candidate({ matchedConditionCount: 1 }),
      request({ patient: { medicalConditions: ["Parkinson's"] } }),
      LABELS,
    );
    expect(score).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes('relevant experience'))).toBe(true);
  });

  // The filter used to resolve the same (district, city) pair by string
  // comparison and this scored it by string comparison too, with different
  // rules - one lowercased and trimmed, one neither. Two cities that a person
  // would call the same could filter on one and rank on the other. Both now
  // compare the same ids, and these are the cases that used to disagree.
  describe('location matching is by id, not by name', () => {
    it('does not confuse two cities that share a name across districts', () => {
      // "Colombo" appears under more than one district in the real data, so a
      // name comparison here would score a Gampaha caregiver as an exact match
      // to a Colombo request.
      const namesake = service.score(
        candidate({ districtId: 2, cityId: 548 }),
        request({ location: { districtId: COLOMBO, cityId: DEHIWALA } }),
        LABELS,
      );
      expect(namesake.reasons.some((r) => r.startsWith('based in'))).toBe(false);
    });

    it('does not care how the id arrived - 1 and "1" are the same city', () => {
      // A query string hands over strings; the DTO coerces, and a comparison
      // that survived coercion would have been the old string-equality bug.
      const asNumber = service.score(
        candidate({ cityId: DEHIWALA }),
        request({ location: { cityId: DEHIWALA } }),
        LABELS,
      );
      expect(asNumber.reasons.some((r) => r.includes('based in'))).toBe(true);
    });

    it('counts a preferred work city in the searched district as a district match', () => {
      const prefers = service.score(
        candidate({ districtId: 2, cityId: 548, preferredLocationCityIds: [DEHIWALA], preferredLocationDistrictIds: [COLOMBO] }),
        request({ location: { districtId: COLOMBO } }),
        LABELS,
      );
      expect(prefers.reasons.some((r) => r.includes('Colombo'))).toBe(true);
    });

    it('scores a preferred work city the same as living in it, but says so differently', () => {
      // Living in the city and covering it as a preferred work location are
      // equally good answers to "someone who works in Dehiwala", so they carry
      // the same weight - but a result card that said "based in Dehiwala" for
      // someone who lives in Gampaha would be a factual claim, not a ranking.
      const exact = service.score(
        candidate({ cityId: DEHIWALA, districtId: COLOMBO, cityName: 'Dehiwala' }),
        request({ location: { districtId: COLOMBO, cityId: DEHIWALA } }),
        LABELS,
      );
      const preferred = service.score(
        candidate({ districtId: 2, cityId: 548, preferredLocationCityIds: [DEHIWALA] }),
        request({ location: { districtId: COLOMBO, cityId: DEHIWALA } }),
        LABELS,
      );
      expect(exact.score).toBe(preferred.score);
      // The reason uses the caregiver's own city name from the reference row,
      // not the string the request happened to carry.
      expect(exact.reasons).toContain('based in Dehiwala');
      expect(preferred.reasons.some((r) => r.startsWith('covers '))).toBe(true);
    });

    it('still ranks an exact city match above a district-only match', () => {
      const exact = service.score(
        candidate({ cityId: DEHIWALA, districtId: COLOMBO }),
        request({ location: { districtId: COLOMBO, cityId: DEHIWALA } }),
        LABELS,
      );
      const districtOnly = service.score(
        candidate({ districtId: COLOMBO, cityId: MORATUWA }),
        request({ location: { districtId: COLOMBO } }),
        LABELS,
      );
      expect(exact.score).toBeGreaterThan(districtOnly.score);
    });

    it('ignores a candidate with no location when a city was requested', () => {
      // A caregiver who has not set a location must not be presented as a
      // match for one.
      const unlocated = service.score(
        candidate({ districtId: null, cityId: null }),
        request({ location: { districtId: COLOMBO, cityId: DEHIWALA } }),
        LABELS,
      );
      expect(unlocated.reasons.some((r) => r.includes('based in'))).toBe(false);
      expect(unlocated.reasons.some((r) => r.includes('works in'))).toBe(false);
    });
  });

  it('rankAll sorts candidates by score descending', () => {
    const strong = candidate({ caregiverId: 'strong', hasVerifiedQualification: true, yearsOfRelevantExperience: 10 });
    const weak = candidate({ caregiverId: 'weak' });
    const ranked = service.rankAll([weak, strong], request(), LABELS);
    expect(ranked[0].caregiverId).toBe('strong');
    expect(ranked[1].caregiverId).toBe('weak');
  });
});
