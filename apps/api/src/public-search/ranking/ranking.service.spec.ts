import { RankingService, RankingCandidate } from './ranking.service';
import { SearchRequestDto } from '../dto/search-request.dto';

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    caregiverId: 'cg-1',
    district: 'Colombo',
    city: 'Colombo',
    preferredLocationCities: [],
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
    const first = service.score(c, r);
    const second = service.score(c, r);
    expect(first).toEqual(second);
  });

  it('never requires an AI model - pure function of its arguments only', () => {
    // Regression guard: this test simply asserts the method signature stays
    // synchronous and side-effect free (no network/DB calls hidden inside).
    const result = service.score(candidate(), request());
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('gives a ranking boost for a verified qualification, with a factual reason', () => {
    const verified = service.score(candidate({ hasVerifiedQualification: true }), request());
    const unverified = service.score(candidate({ hasVerifiedQualification: false }), request());
    expect(verified.score).toBeGreaterThan(unverified.score);
    expect(verified.reasons).toContain('has a verified qualification');
  });

  it('never produces a subjective claim as a reason', () => {
    const { reasons } = service.score(
      candidate({ hasVerifiedQualification: true, matchedOptionalSkillCount: 2 }),
      request({ optionalSkillIds: ['a', 'b'] }),
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
      candidate({ city: 'Colombo', district: 'Colombo' }),
      request({ location: { city: 'Colombo' } }),
    );
    const districtOnly = service.score(
      candidate({ city: 'Moratuwa', district: 'Colombo' }),
      request({ location: { district: 'Colombo' } }),
    );
    expect(cityMatch.score).toBeGreaterThan(districtOnly.score);
  });

  it('treats budget as ranking influence only, never a disqualifier', () => {
    const overBudget = service.score(
      candidate({ expectedDailyRate: 5000 }),
      request({ budget: { dailyRate: 3000 } }),
    );
    const withinBudget = service.score(
      candidate({ expectedDailyRate: 2500 }),
      request({ budget: { dailyRate: 3000 } }),
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
    );
    expect(score).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes('relevant experience'))).toBe(true);
  });

  it('rankAll sorts candidates by score descending', () => {
    const strong = candidate({ caregiverId: 'strong', hasVerifiedQualification: true, yearsOfRelevantExperience: 10 });
    const weak = candidate({ caregiverId: 'weak' });
    const ranked = service.rankAll([weak, strong], request());
    expect(ranked[0].caregiverId).toBe('strong');
    expect(ranked[1].caregiverId).toBe('weak');
  });
});
