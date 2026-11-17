import { visitState, type CheckInSettings } from '@care-platform/shared';

/**
 * What the live-care agent does about one visit. Pure rules: the same visit
 * at the same moment always gives the same step, and every step is something
 * a staff member would have done from Today's visits.
 */

/** After chasing the caregiver, how long before staff are told the visit is still not checked in. */
export const FLAG_AFTER_CHASE_MINUTES = 15;
/** A visit counts as done when the caregiver was there for at least this share of the scheduled time. */
export const COMPLETE_MIN_SHARE = 0.75;
/** Visits that ended longer ago than this are history: the agent leaves them to staff. */
export const LIVE_WINDOW_HOURS = 12;

export interface LiveVisit {
  startsAt: Date | string;
  endsAt: Date | string;
  /** Only scheduled shifts are acted on. */
  status: string;
  checkedInAt: Date | string | null;
  checkedOutAt: Date | string | null;
  /** When the caregiver was chased (or the chase was logged or proposed); null if never. */
  chasedAt: Date | string | null;
}

export type FlagKind = 'STILL_LATE' | 'NO_CHECK_IN' | 'LEFT_EARLY';

export type LiveStep =
  | { step: 'none' }
  /** Started a while ago with nobody checked in: ask the caregiver to check in or call. */
  | { step: 'chase'; minutesLate: number }
  /** A person is needed: still not checked in after the chase, ended with no check-in, or the caregiver left early. */
  | { step: 'flag'; kind: FlagKind; minutes: number; ofMinutes?: number }
  /** In and out, for long enough: the shift is done. */
  | { step: 'complete'; minutesThere: number; ofMinutes: number };

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));
const minutes = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 60_000));

export function liveStep(visit: LiveVisit, settings: Pick<CheckInSettings, 'earlyMinutes' | 'lateAfterMinutes'>, now: Date = new Date()): LiveStep {
  if (visit.status !== 'SCHEDULED') return { step: 'none' };
  const t = now.getTime();
  const start = ms(visit.startsAt);
  const end = ms(visit.endsAt);
  if (t - end > LIVE_WINDOW_HOURS * 3_600_000) return { step: 'none' };

  if (visit.checkedInAt && visit.checkedOutAt) {
    const there = minutes(ms(visit.checkedInAt), ms(visit.checkedOutAt));
    const of = minutes(start, end);
    return there >= of * COMPLETE_MIN_SHARE ? { step: 'complete', minutesThere: there, ofMinutes: of } : { step: 'flag', kind: 'LEFT_EARLY', minutes: there, ofMinutes: of };
  }
  if (visit.checkedInAt) return { step: 'none' }; // there now; nothing to do until they leave

  const state = visitState({ ...visit, checkedInAt: null, checkedOutAt: null }, settings, now);
  if (state === 'LATE') {
    if (!visit.chasedAt) return { step: 'chase', minutesLate: minutes(start, t) };
    return t - ms(visit.chasedAt) >= FLAG_AFTER_CHASE_MINUTES * 60_000 ? { step: 'flag', kind: 'STILL_LATE', minutes: minutes(start, t) } : { step: 'none' };
  }
  if (state === 'NOT_RECORDED') return { step: 'flag', kind: 'NO_CHECK_IN', minutes: minutes(start, end) };
  return { step: 'none' };
}

const span = (m: number) => (m >= 120 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`);

/** The flag in plain words, for the decision log, the staff notice and the handover note. */
export function flagReason(kind: FlagKind, step: { minutes: number; ofMinutes?: number }, who: string, startTime: string): string {
  if (kind === 'STILL_LATE') return `${who} was due at ${startTime}, was asked to check in, and still has not (${span(step.minutes)} late)`;
  if (kind === 'NO_CHECK_IN') return `The ${startTime} visit ended with no check-in from ${who}`;
  return `${who} checked out after ${span(step.minutes)} of a ${span(step.ofMinutes ?? 0)} visit`;
}

export const FLAG_NEXT: Record<FlagKind, string> = {
  STILL_LATE: 'Staff to phone the caregiver, then the client',
  NO_CHECK_IN: 'Staff to find out whether the visit happened, and mark the shift done or missed',
  LEFT_EARLY: 'Staff to check with the client, then mark the shift done or change its times',
};
