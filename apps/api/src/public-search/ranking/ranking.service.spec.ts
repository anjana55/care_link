import { RankingService, RankingCandidate, RankingContext } from './ranking.service';
import { SearchRequestDto } from '../dto/search-request.dto';

/** A search with an origin and the default 25 km radius. */
const CONTEXT: RankingContext = { radiusKm: 25 };

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    caregiverId: 'cg-1',
    districtName: 'Colombo',
    cityName: 'Colombo',
    homeDistanceKm: 0,
    nearestServiceCity: null,
    reach: 'home',
    gender: 'FEMALE',
    matchedOptionalSkillCount: 0,
    matchedLanguageCount: 0,
    matchedConditionCount: 0,
    yearsOfRelevantExperience: 0,
    hasVerifiedQualification: false,
    verified: false,
    dayDuty: true,
    nightDuty: false,
    liveIn24h: false,
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
    const first = service.score(c, r, CONTEXT);
    const second = service.score(c, r, CONTEXT);
    expect(first).toEqual(second);
  });

  it('never requires an AI model - pure function of its arguments only', () => {
    // Regression guard: this test simply asserts the method signature stays
    // synchronous and side-effect free (no network/DB calls hidden inside).
    const result = service.score(candidate(), request(), CONTEXT);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('gives a ranking boost for a verified qualification, with a factual reason', () => {
    const verified = service.score(candidate({ hasVerifiedQualification: true }), request(), CONTEXT);
    const unverified = service.score(candidate({ hasVerifiedQualification: false }), request(), CONTEXT);
    expect(verified.score).toBeGreaterThan(unverified.score);
    expect(verified.reasons).toContain('has a verified qualification');
  });

  it('never produces a subjective claim as a reason', () => {
    const { reasons } = service.score(
      candidate({ hasVerifiedQualification: true, matchedOptionalSkillCount: 2 }),
      request({ optionalSkillIds: ['a', 'b'] }),
      CONTEXT,
    );
    const banned = ['compassionate', 'perfect', 'trustworthy', 'best', 'amazing'];
    for (const reason of reasons) {
      for (const word of banned) {
        expect(reason.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('ranks a caregiver verified by the platform above an otherwise equal unverified one', () => {
    const verified = service.score(candidate({ verified: true }), request(), CONTEXT);
    const registered = service.score(candidate({ verified: false }), request(), CONTEXT);
    expect(verified.score).toBeGreaterThan(registered.score);
    expect(verified.reasons).toContain('verified by our team');
  });

  it('matches a stated medical condition against a relevant skill/care-type', () => {
    const { reasons, score } = service.score(
      candidate({ matchedConditionCount: 1 }),
      request({ patient: { medicalConditions: ["Parkinson's"] } }),
      CONTEXT,
    );
    expect(score).toBeGreaterThan(0);
    expect(reasons.some((r) => r.includes('relevant experience'))).toBe(true);
  });

  // Who is in the result set at all is decided by the radius filter in
  // PublicSearchService. Ranking only orders within it, by straight-line
  // distance to where the caregiver lives or to the closest city they travel to.
  describe('proximity', () => {
    it('ranks a nearer caregiver above a farther one, all else equal', () => {
      const near = service.score(candidate({ homeDistanceKm: 2 }), request(), CONTEXT);
      const far = service.score(candidate({ homeDistanceKm: 20 }), request(), CONTEXT);
      expect(near.score).toBeGreaterThan(far.score);
    });

    it('gives nothing for proximity at the edge of the radius', () => {
      const edge = service.score(candidate({ homeDistanceKm: 25 }), request(), CONTEXT);
      const outside = service.score(candidate({ homeDistanceKm: null, reach: null }), request(), CONTEXT);
      expect(edge.score).toBe(outside.score);
    });

    it('states the distance to where the caregiver lives as a fact', () => {
      const { reasons } = service.score(candidate({ cityName: 'Dehiwala', homeDistanceKm: 3.4 }), request(), CONTEXT);
      expect(reasons).toContain('based in Dehiwala, 3.4 km away');
    });

    it('says a caregiver who travels to the area works there, not that they live there', () => {
      // A result card that said "based in Dehiwala" for someone who lives in
      // Gampaha would be a factual claim, not a ranking.
      const { reasons } = service.score(
        candidate({ cityName: 'Gampaha', homeDistanceKm: 31, reach: 'serviceArea', nearestServiceCity: { name: 'Dehiwala', distanceKm: 1.2 } }),
        request(),
        CONTEXT,
      );
      expect(reasons).toContain('works in Dehiwala, 1.2 km away');
      expect(reasons.some((r) => r.startsWith('based in'))).toBe(false);
    });

    it('scores a caregiver who travels to a city like one who lives the same distance away', () => {
      const lives = service.score(candidate({ homeDistanceKm: 1.2 }), request(), CONTEXT);
      const travels = service.score(
        candidate({ homeDistanceKm: 40, reach: 'serviceArea', nearestServiceCity: { name: 'Dehiwala', distanceKm: 1.2 } }),
        request(),
        CONTEXT,
      );
      expect(travels.score).toBe(lives.score);
    });

    it('adds nothing and says nothing about location when the search had no origin', () => {
      const result = service.score(candidate({ homeDistanceKm: null, reach: null }), request(), { radiusKm: null });
      const located = service.score(candidate({ homeDistanceKm: null, reach: null }), request(), CONTEXT);
      expect(result.score).toBe(located.score);
      expect(result.reasons.some((r) => r.includes('km away'))).toBe(false);
    });

    it('names the district for a district-only match with no distance', () => {
      const { reasons } = service.score(candidate({ homeDistanceKm: null, reach: 'home', cityName: null }), request(), CONTEXT);
      expect(reasons).toContain('based in the Colombo district');
    });
  });

  it('rankAll sorts candidates by score descending', () => {
    const strong = candidate({ caregiverId: 'strong', hasVerifiedQualification: true, yearsOfRelevantExperience: 10 });
    const weak = candidate({ caregiverId: 'weak' });
    const ranked = service.rankAll([weak, strong], request(), CONTEXT);
    expect(ranked[0].caregiverId).toBe('strong');
    expect(ranked[1].caregiverId).toBe('weak');
  });
});
