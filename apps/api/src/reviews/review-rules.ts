import {
  REVIEW_BADGES,
  REVIEW_IMPROVEMENT_TAGS,
  roundRating,
  type BadgeCount,
  type CaregiverRatingSummary,
  type ReviewImprovementTag,
  type ReviewSettings,
} from '@care-platform/shared';

/**
 * The pure rules behind ratings - who may rate whom and until when, and what
 * is shown publicly - kept free of the database so they are easy to test.
 */

export interface ShiftForReview {
  caregiverId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export interface WorkedWindow {
  caregiverId: string;
  /** Worked only as a cover, not the booked caregiver. */
  isCover: boolean;
  firstWorkedStart: Date;
  lastWorkedAt: Date;
  reviewUntil: Date;
  /** Rating is open now. */
  open: boolean;
  /** They still have scheduled shifts to come on this booking. */
  hasUpcoming: boolean;
}

const DAY_MS = 86_400_000;

/**
 * A shift counts as worked when staff marked it completed, or it was scheduled
 * and has ended (staff don't always mark shifts completed). Missed, cancelled
 * and draft shifts never count.
 */
export const isWorked = (s: { status: string; endsAt: Date }, now: Date) =>
  (s.status === 'COMPLETED' || s.status === 'SCHEDULED') && new Date(s.endsAt).getTime() <= now.getTime();

/** Each caregiver who has worked on a booking, and their rating window. Booked caregiver first. */
export function workedWindows(shifts: ShiftForReview[], bookedCaregiverId: string, now: Date, windowDays: number): WorkedWindow[] {
  const byCaregiver = new Map<string, ShiftForReview[]>();
  for (const s of shifts) byCaregiver.set(s.caregiverId, [...(byCaregiver.get(s.caregiverId) ?? []), s]);
  const out: WorkedWindow[] = [];
  for (const [caregiverId, list] of byCaregiver) {
    const worked = list.filter((s) => isWorked(s, now));
    if (!worked.length) continue;
    const firstWorkedStart = new Date(Math.min(...worked.map((s) => new Date(s.startsAt).getTime())));
    const lastWorkedAt = new Date(Math.max(...worked.map((s) => new Date(s.endsAt).getTime())));
    const reviewUntil = new Date(lastWorkedAt.getTime() + windowDays * DAY_MS);
    out.push({
      caregiverId,
      isCover: caregiverId !== bookedCaregiverId,
      firstWorkedStart,
      lastWorkedAt,
      reviewUntil,
      open: now.getTime() <= reviewUntil.getTime(),
      hasUpcoming: list.some((s) => s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > now.getTime()),
    });
  }
  return out.sort((a, b) => Number(a.isCover) - Number(b.isCover) || a.firstWorkedStart.getTime() - b.firstWorkedStart.getTime());
}

/** Days into a booking after which a caregiver still working is asked about (a long booking gets an early ask). */
export const EARLY_ASK_DAYS = 7;
/** Days after the first ask that one reminder goes. */
export const REMINDER_AFTER_DAYS = 3;

/**
 * Whether the client should be asked to rate this caregiver now: their work
 * on the booking is over, or they have been working on it a week.
 */
export function dueForAsk(w: WorkedWindow, now: Date): boolean {
  if (!w.open) return false;
  if (!w.hasUpcoming) return true;
  return now.getTime() - w.firstWorkedStart.getTime() >= EARLY_ASK_DAYS * DAY_MS;
}

export function dueForReminder(askedAt: Date, w: WorkedWindow, now: Date): boolean {
  return w.open && now.getTime() - new Date(askedAt).getTime() >= REMINDER_AFTER_DAYS * DAY_MS;
}

/** Badge counts, most first, then in the catalogue order so ties never shuffle. */
export function sortBadgeCounts(counts: BadgeCount[]): BadgeCount[] {
  return counts
    .filter((c) => c.count > 0 && (REVIEW_BADGES as readonly string[]).includes(c.badge))
    .sort((a, b) => b.count - a.count || REVIEW_BADGES.indexOf(a.badge) - REVIEW_BADGES.indexOf(b.badge));
}

export interface RatingStats {
  ratingCount: number;
  ratingSum: number;
  badgeCounts: BadgeCount[];
}

/** Whether a caregiver's average is shown publicly yet. */
export const shownPublicly = (count: number, settings: ReviewSettings) => settings.enabled && count >= settings.minRatingsToShow;

/** What search cards and profiles show: nothing until the caregiver has enough ratings. */
export function publicSummary(stats: RatingStats | undefined, settings: ReviewSettings, topBadges = 3): CaregiverRatingSummary | null {
  if (!stats || !shownPublicly(stats.ratingCount, settings)) return null;
  return {
    average: roundRating(stats.ratingSum, stats.ratingCount),
    count: stats.ratingCount,
    topBadges: sortBadgeCounts(stats.badgeCounts).slice(0, topBadges),
  };
}

/**
 * The ranking signal: a smoothed average that pulls a few ratings towards a
 * prior, so three fives don't beat forty 4.9s. 0..1, where 1 is a perfect 5.
 * Null below the public threshold - an unrated caregiver is neither helped nor hurt.
 */
export const RATING_PRIOR_MEAN = 4.5;
export const RATING_PRIOR_WEIGHT = 5;
export function ratingSignal(count: number, sum: number, minRatings: number): number | null {
  if (count < minRatings || count <= 0) return null;
  const smoothed = (sum + RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT) / (count + RATING_PRIOR_WEIGHT);
  return Math.max(0, Math.min(1, (smoothed - 1) / 4));
}

export const parseTags = (s: string | null | undefined): ReviewImprovementTag[] =>
  (s ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is ReviewImprovementTag => (REVIEW_IMPROVEMENT_TAGS as readonly string[]).includes(t));

export const formatTags = (tags: readonly string[]) => (tags.length ? [...new Set(tags)].join(',') : null);
