import { MODEL_MAX_MOVE, applyModelOrder, buildRankPrompt, offerMinutesFor, rankMatches, scoreMatch, type MatchCandidate, type MatchRequest } from './matching-rules';

const request: MatchRequest = { careType: 'HOME_SHIFT', districtId: 1, cityId: 10, schedule: 'DAY', urgency: 'WITHIN_WEEK', desiredStartDate: '2026-11-16' };
const cg = (n: number, over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  caregiverId: `id-${n}`,
  registrationNumber: `CG-${String(n).padStart(4, '0')}`,
  verified: false,
  sameCity: false,
  sameDistrict: true,
  travelsToCity: false,
  dayDuty: false,
  nightDuty: false,
  liveIn24h: false,
  ratingSignal: null,
  ratingAverage: null,
  ratingCount: 0,
  ownRate: null,
  availableFrom: null,
  runningBookings: 0,
  recentUnanswered: 0,
  recentAccepted: 0,
  ...over,
});

describe('matching rules', () => {
  it('gives every point a reason a person can read', () => {
    const r = scoreMatch(request, cg(1, { verified: true, sameCity: true, dayDuty: true, ratingSignal: 0.9, ratingAverage: 4.8, ratingCount: 12, ownRate: { amount: 3000, rateType: 'DAILY' }, availableFrom: '2026-11-01' }));
    expect(r.reasons).toEqual(['Checked by the office', 'Lives in the same town', 'Rated 4.8 by 12 clients', 'Works day shifts', 'Own rate LKR 3,000 per day', 'Free by the start date']);
    expect(r.score).toBe(30 + 20 + 14 + 10 + 8 + 5);
  });

  it('puts a checked, nearby, free caregiver ahead of a busy or unreliable one', () => {
    const ranked = rankMatches(request, [
      cg(1, { verified: true, runningBookings: 1 }),
      cg(2, { verified: true, sameCity: true }),
      cg(3, { verified: true, sameCity: true, recentUnanswered: 5 }),
      cg(4, { sameCity: true, availableFrom: '2026-12-01' }),
    ]);
    expect(ranked.map((r) => r.registrationNumber)).toEqual(['CG-0002', 'CG-0003', 'CG-0001', 'CG-0004']);
    expect(ranked[1].reasons).toContain('Turned down or missed 5 recent offers');
    expect(ranked[3].reasons).toContain('Free only from 2026-12-01');
  });

  it('breaks ties the same way every time', () => {
    const a = rankMatches(request, [cg(3), cg(1), cg(2)]);
    const b = rankMatches(request, [cg(2), cg(3), cg(1)]);
    expect(a.map((r) => r.caregiverId)).toEqual(['id-1', 'id-2', 'id-3']);
    expect(b).toEqual(a);
  });

  it('counts travelling to the town for more than only living in the district', () => {
    const [first, second] = rankMatches(request, [cg(1), cg(2, { sameDistrict: false, travelsToCity: true })]);
    expect(first.registrationNumber).toBe('CG-0002');
    expect(second.reasons).toEqual(['Lives in the same district']);
  });

  it('gives less time to answer the sooner care is needed', () => {
    expect(offerMinutesFor('IMMEDIATELY')).toBe(60);
    expect(offerMinutesFor('WITHIN_WEEK')).toBe(240);
    expect(offerMinutesFor('WITHIN_MONTH')).toBe(1440);
    expect(offerMinutesFor(null)).toBe(1440);
  });
});

describe('what a model is shown and how far it is trusted', () => {
  const pool = [1, 2, 3, 4, 5, 6].map((n) => cg(n, { verified: n <= 3, sameCity: n % 2 === 0 }));
  const ranked = rankMatches(request, pool);

  it('shows caregivers as C1, C2... with nothing that identifies them', () => {
    const prompt = buildRankPrompt({ ...request, cityName: 'Nugegoda', districtName: 'Colombo' }, pool, ranked);
    expect(prompt.labels).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    const sent = prompt.system + prompt.user;
    for (const c of pool) {
      expect(sent).not.toContain(c.caregiverId);
      expect(sent).not.toContain(c.registrationNumber);
    }
    expect(JSON.parse(prompt.user).job).toEqual({ careType: 'HOME_SHIFT', town: 'Nugegoda', district: 'Colombo', schedule: 'DAY', neededBy: 'WITHIN_WEEK', startDate: '2026-11-16' });
  });

  it('applies a sensible reorder and keeps the reason given', () => {
    const out = applyModelOrder(ranked, JSON.stringify({ order: ['C2', 'C1', 'C3', 'C4', 'C5', 'C6'], reasons: { C2: 'Closer   and free\nsooner' } }));
    expect(out.ranked.map((r) => r.caregiverId)).toEqual([ranked[1], ranked[0], ...ranked.slice(2)].map((r) => r.caregiverId));
    expect(out.ranked[0].reasons.at(-1)).toBe('AI: Closer and free sooner');
    expect(out.moved).toBe(2);
  });

  it('never lets anyone jump more than a few places, drops made-up ids and keeps those left out', () => {
    const out = applyModelOrder(ranked, '{"order": ["C6", "C99", "C1", "C6"]}');
    const ids = out.ranked.map((r) => r.caregiverId);
    expect([...ids].sort()).toEqual(ranked.map((r) => r.caregiverId).sort());
    expect(ids.indexOf(ranked[5].caregiverId)).toBeGreaterThanOrEqual(5 - MODEL_MAX_MOVE);
    expect(ids.indexOf(ranked[0].caregiverId)).toBeLessThanOrEqual(MODEL_MAX_MOVE);
  });

  it("keeps the rules' order when the answer cannot be read", () => {
    for (const bad of ['', 'I think C2 is best', '{"order": "C2"}', '{"reasons": {}}', '[1,2]']) {
      expect(applyModelOrder(ranked, bad)).toEqual({ ranked, moved: 0 });
    }
  });

  it('reads an answer wrapped in other text', () => {
    const out = applyModelOrder(ranked, 'Here you go:\n```json\n{"order":["C2","C1"]}\n```');
    expect(out.ranked[0].caregiverId).toBe(ranked[1].caregiverId);
  });
});
