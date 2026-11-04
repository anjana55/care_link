import { DEFAULT_REVIEW_SETTINGS, detectReviewLanguage, findContactDetails, reviewSubmitSchema } from '@care-platform/shared';
import { RankingService } from '../public-search/ranking/ranking.service';
import type { SearchRequestDto } from '../public-search/dto/search-request.dto';
import { dueForAsk, dueForReminder, publicSummary, ratingSignal, sortBadgeCounts, workedWindows } from './review-rules';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date('2026-11-04T06:00:00Z');
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
const shift = (caregiverId: string, fromHours: number, status = 'SCHEDULED', hours = 9) => ({ caregiverId, startsAt: at(fromHours), endsAt: at(fromHours + hours), status });

describe('who can rate whom, and until when', () => {
  it('counts completed shifts, and scheduled ones that have ended - never missed, cancelled or future ones', () => {
    const w = workedWindows(
      [shift('a', -30), shift('a', 30), shift('b', -60, 'MISSED'), shift('c', -60, 'CANCELLED'), shift('d', 10), shift('e', -100, 'COMPLETED')],
      'a',
      now,
      90,
    );
    expect(w.map((x) => x.caregiverId)).toEqual(['a', 'e']);
    expect(w[0]).toMatchObject({ isCover: false, hasUpcoming: true, open: true });
    expect(w[1]).toMatchObject({ isCover: true, hasUpcoming: false });
    expect(w[0].lastWorkedAt).toEqual(at(-21));
  });

  it('closes the window the set number of days after the last worked shift', () => {
    const [w] = workedWindows([shift('a', -91 * 24)], 'a', now, 90);
    expect(w.open).toBe(false);
    const [later] = workedWindows([shift('a', -91 * 24), shift('a', -24)], 'a', now, 90);
    expect(later.open).toBe(true);
    expect(later.reviewUntil).toEqual(new Date(at(-15).getTime() + 90 * DAY));
  });

  it('asks when the work is over, or after a week on a long booking, and reminds three days later', () => {
    const [over] = workedWindows([shift('a', -30)], 'a', now, 90);
    const [justStarted] = workedWindows([shift('a', -30), shift('a', 30)], 'a', now, 90);
    const [aWeekIn] = workedWindows([shift('a', -8 * 24), shift('a', 30)], 'a', now, 90);
    expect(dueForAsk(over, now)).toBe(true);
    expect(dueForAsk(justStarted, now)).toBe(false);
    expect(dueForAsk(aWeekIn, now)).toBe(true);
    expect(dueForReminder(at(-2 * 24), over, now)).toBe(false);
    expect(dueForReminder(at(-3 * 24), over, now)).toBe(true);
  });
});

describe('what is shown publicly', () => {
  const stats = { ratingCount: 3, ratingSum: 13, badgeCounts: [{ badge: 'PUNCTUAL' as const, count: 1 }, { badge: 'KIND_PATIENT' as const, count: 2 }, { badge: 'GOOD_COOK' as const, count: 1 }, { badge: 'TRUSTWORTHY' as const, count: 1 }] };

  it('shows nothing below the threshold, or with ratings switched off', () => {
    expect(publicSummary({ ...stats, ratingCount: 2 }, DEFAULT_REVIEW_SETTINGS)).toBeNull();
    expect(publicSummary(stats, { ...DEFAULT_REVIEW_SETTINGS, enabled: false })).toBeNull();
    expect(publicSummary(undefined, DEFAULT_REVIEW_SETTINGS)).toBeNull();
  });

  it('rounds the average to one place and lists the top three badges, ties in catalogue order', () => {
    expect(publicSummary(stats, DEFAULT_REVIEW_SETTINGS)).toEqual({
      average: 4.3,
      count: 3,
      topBadges: [
        { badge: 'KIND_PATIENT', count: 2 },
        { badge: 'PUNCTUAL', count: 1 },
        { badge: 'TRUSTWORTHY', count: 1 },
      ],
    });
    expect(sortBadgeCounts([{ badge: 'EXTRA_MILE', count: 0 }])).toEqual([]);
  });
});

describe('the ranking signal', () => {
  it('is absent below the threshold and smooths a few ratings towards the prior', () => {
    expect(ratingSignal(2, 10, 3)).toBeNull();
    const fewFives = ratingSignal(3, 15, 3)!;
    const manyHigh = ratingSignal(40, 196, 3)!;
    expect(manyHigh).toBeGreaterThan(fewFives);
    expect(ratingSignal(10, 10, 3)!).toBeLessThan(ratingSignal(10, 40, 3)!);
  });

  it('adds up to 15 points and never changes an unrated caregiver', () => {
    const ranking = new RankingService();
    const base = {
      caregiverId: 'x', cityName: null, districtName: null, homeDistanceKm: null, nearestServiceCity: null, reach: null, gender: 'FEMALE' as const,
      matchedOptionalSkillCount: 0, matchedLanguageCount: 0, matchedConditionCount: 0, yearsOfRelevantExperience: 0, hasVerifiedQualification: false,
      verified: false, dayDuty: false, nightDuty: false, liveIn24h: false,
    };
    const req = {} as SearchRequestDto;
    const ctx = { radiusKm: null };
    expect(ranking.score({ ...base, ratingSignal: null }, req, ctx).score).toBe(0);
    expect(ranking.score({ ...base, ratingSignal: 1 }, req, ctx).score).toBe(15);
    expect(ranking.score(base, req, ctx).score).toBe(0);
  });
});

describe('review text', () => {
  it('finds phone numbers, email addresses and links', () => {
    expect(findContactDetails('Call 077 123 4567 any time')).toBe('phone');
    expect(findContactDetails('+94771234567')).toBe('phone');
    expect(findContactDetails('write to me@example.com')).toBe('email');
    expect(findContactDetails('see www.example.lk')).toBe('link');
    expect(findContactDetails('see https://x.y/z')).toBe('link');
    expect(findContactDetails('She came for 3 months in 2026, 5 days a week.')).toBeNull();
    expect(findContactDetails(null)).toBeNull();
  });

  it('tells Sinhala, Tamil and English apart', () => {
    expect(detectReviewLanguage('ඉතා හොඳ සේවයක්')).toBe('si');
    expect(detectReviewLanguage('மிகவும் நல்ல சேவை')).toBe('ta');
    expect(detectReviewLanguage('Very good care')).toBe('en');
  });

  it('applies the same rules in the shared form schema as the API', () => {
    expect(reviewSubmitSchema.safeParse({ rating: 5, badges: ['PUNCTUAL'] }).success).toBe(true);
    expect(reviewSubmitSchema.safeParse({ rating: 3, badges: ['PUNCTUAL'] }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ rating: 5, improvementTags: ['HYGIENE'] }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ rating: 4, comment: 'short' }).success).toBe(false);
    expect(reviewSubmitSchema.safeParse({ rating: 4, comment: 'Call me on 0771234567 please' }).success).toBe(false);
  });
});
