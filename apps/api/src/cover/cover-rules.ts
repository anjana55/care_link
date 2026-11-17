import { effectiveCareOfferStatus, toColombo, visitState, type CareOfferStatus, type CheckInSettings } from '@care-platform/shared';
import type { MatchRequest, Schedule } from '../matching/matching-rules';

/**
 * When the live-care agent looks for cover, and when it stops. Pure rules:
 * the same visit, the same offers and the same moment always give the same
 * step. Who is asked is decided by the matching rules (rankMatches).
 */

/** After a visit counts as late, how much longer before cover is looked for - the caregiver has been chased by then. */
export const COVER_AFTER_LATE_MINUTES = 15;
/** With less of the visit left than this, cover is not worth sending. */
export const COVER_MIN_REMAINING_MINUTES = 60;
/** Caregivers asked at a time. */
export const COVER_WAVE = 3;
/** Cover offers for one shift before the agent stops and tells staff. */
export const COVER_MAX_OFFERS = 6;

export interface CoverVisit {
  startsAt: Date | string;
  endsAt: Date | string;
  /** Only scheduled shifts are covered. */
  status: string;
  checkedInAt: Date | string | null;
}

export type CoverStep =
  | { step: 'none' }
  /** Nobody has come and nobody is being asked: offer the shift to the next few caregivers. */
  | { step: 'offer'; wave: number; minutesLate: number; minutesLeft: number }
  /** Everyone asked said no or did not answer, and the agent will ask no more: a person takes over. */
  | { step: 'giveUp'; asked: number; minutesLate: number };

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

export function coverStep(
  visit: CoverVisit,
  settings: Pick<CheckInSettings, 'earlyMinutes' | 'lateAfterMinutes'>,
  offers: { status: CareOfferStatus; expiresAt: Date | string }[],
  now: Date = new Date(),
): CoverStep {
  if (visit.status !== 'SCHEDULED' || visit.checkedInAt) return { step: 'none' };
  // Late means started, not over, and nobody checked in.
  if (visitState({ ...visit, checkedInAt: null, checkedOutAt: null }, settings, now) !== 'LATE') return { step: 'none' };
  const t = now.getTime();
  const minutesLate = Math.floor((t - ms(visit.startsAt)) / 60_000);
  if (minutesLate < settings.lateAfterMinutes + COVER_AFTER_LATE_MINUTES) return { step: 'none' };

  const states = offers.map((o) => effectiveCareOfferStatus(o.status, o.expiresAt, now));
  // Someone took it (they are on their way), or someone is still deciding.
  if (states.includes('ACCEPTED') || states.includes('OFFERED')) return { step: 'none' };

  const minutesLeft = Math.floor((ms(visit.endsAt) - t) / 60_000);
  if (offers.length >= COVER_MAX_OFFERS || (offers.length > 0 && minutesLeft < COVER_MIN_REMAINING_MINUTES)) return { step: 'giveUp', asked: offers.length, minutesLate };
  if (minutesLeft < COVER_MIN_REMAINING_MINUTES) return { step: 'none' };
  return { step: 'offer', wave: Math.floor(offers.length / COVER_WAVE) + 1, minutesLate, minutesLeft };
}

/** Day, night or live-in, read from the shift's own times (Sri Lanka's clock). */
export function shiftSchedule(startsAt: Date | string, endsAt: Date | string): Schedule {
  if (ms(endsAt) - ms(startsAt) >= 20 * 3_600_000) return 'LIVE_IN_24H';
  const hour = Number(toColombo(startsAt).time.slice(0, 2));
  return hour >= 5 && hour < 17 ? 'DAY' : 'NIGHT';
}

/** One shift as the matching rules see a request: what is needed, where and when - nothing about who the client is. */
export function coverRequest(shift: { startsAt: Date | string; endsAt: Date | string; careType: string | null; districtId: number; cityId: number | null }): MatchRequest {
  return {
    careType: shift.careType ?? '',
    districtId: shift.districtId,
    cityId: shift.cityId,
    schedule: shiftSchedule(shift.startsAt, shift.endsAt),
    urgency: 'IMMEDIATELY',
    desiredStartDate: toColombo(shift.startsAt).date,
  };
}
