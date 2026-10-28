import type { PublicCaregiverProfile } from './public-search';

/**
 * Bookings and shifts, shared by the API and both web apps.
 *
 * Time zone: CareLink serves Sri Lanka only, and Sri Lanka keeps one fixed
 * offset (UTC+05:30, no daylight saving). Shift instants travel as ISO-8601
 * UTC strings; everything a person types or reads is Colombo wall-clock time.
 * The helpers below are the single place that converts between the two, so the
 * API's generator and the forms that edit a shift can never disagree.
 */
export const COLOMBO_OFFSET_MINUTES = 330;
export const COLOMBO_TIME_ZONE = 'Asia/Colombo';

export type BookingStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type ShiftStatus = 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
export type ScheduleType = 'DAY' | 'NIGHT' | 'LIVE_IN' | 'CUSTOM';
export type RateType = 'HOURLY' | 'DAILY' | 'MONTHLY';

/** ISO weekday numbers: 1 = Monday ... 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ALL_WEEKDAYS: IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** The usual hours for each schedule type; staff can change them. An end at or before the start runs past midnight. */
export const SCHEDULE_PRESETS: Record<Exclude<ScheduleType, 'CUSTOM'>, { start: string; end: string; days: IsoWeekday[] }> = {
  DAY: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  NIGHT: { start: '20:00', end: '08:00', days: [1, 2, 3, 4, 5, 6, 7] },
  LIVE_IN: { start: '08:00', end: '08:00', days: [1, 2, 3, 4, 5, 6, 7] },
};

/** Longest a single shift may run - a 24-hour live-in day. */
export const MAX_SHIFT_HOURS = 24;
/** Most shifts one booking may generate at once (a year of daily shifts, with room). */
export const MAX_GENERATED_SHIFTS = 400;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTime = (v: string) => TIME.test(v);
export const isValidDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** 'YYYY-MM-DD' + 'HH:MM' in Colombo -> the UTC instant. */
export function colomboToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - COLOMBO_OFFSET_MINUTES * 60_000);
}

/** 'YYYY-MM-DDTHH:MM' (a datetime-local value, Colombo) -> ISO UTC, or null if malformed. */
export function colomboLocalToIso(local: string): string | null {
  const m = LOCAL.exec(local);
  if (!m || !isValidDate(m[1])) return null;
  return colomboToUtc(m[1], `${m[2]}:${m[3]}`).toISOString();
}

/** An instant -> its Colombo wall-clock parts. */
export function toColombo(instant: Date | string): { date: string; time: string; weekday: IsoWeekday } {
  const shifted = new Date(new Date(instant).getTime() + COLOMBO_OFFSET_MINUTES * 60_000);
  const iso = shifted.toISOString();
  const day = shifted.getUTCDay();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16), weekday: (day === 0 ? 7 : day) as IsoWeekday };
}

/** An instant -> a datetime-local value in Colombo time ('YYYY-MM-DDTHH:MM'). */
export function isoToColomboLocal(instant: Date | string): string {
  const { date, time } = toColombo(instant);
  return `${date}T${time}`;
}

/** Today's date in Colombo. */
export function colomboToday(now: Date = new Date()): string {
  return toColombo(now).date;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): IsoWeekday {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day === 0 ? 7 : day) as IsoWeekday;
}

export interface ShiftPattern {
  startDate: string;
  endDate: string;
  daysOfWeek: IsoWeekday[];
  shiftStartTime: string;
  shiftEndTime: string;
}

/**
 * The shifts a booking's pattern describes: one per selected weekday between
 * the two dates (inclusive), from the start time to the end time in Colombo.
 * An end time at or before the start time finishes the next day (a night
 * shift, or a 24-hour live-in day when the two are equal).
 *
 * Pure and deterministic - the API stores what this returns as DRAFT shifts,
 * and the staff form previews the same count before anything is saved.
 */
export function generateShifts(p: ShiftPattern): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  if (!isValidDate(p.startDate) || !isValidDate(p.endDate) || p.endDate < p.startDate) return out;
  if (!isValidTime(p.shiftStartTime) || !isValidTime(p.shiftEndTime)) return out;
  const days = new Set(p.daysOfWeek);
  const overnight = p.shiftEndTime <= p.shiftStartTime;
  for (let d = p.startDate; d <= p.endDate && out.length < MAX_GENERATED_SHIFTS + 1; d = addDays(d, 1)) {
    if (!days.has(isoWeekday(d))) continue;
    const startsAt = colomboToUtc(d, p.shiftStartTime);
    const endsAt = colomboToUtc(overnight ? addDays(d, 1) : d, p.shiftEndTime);
    out.push({ startsAt, endsAt });
  }
  return out;
}

export const shiftHours = (startsAt: Date | string, endsAt: Date | string) =>
  Math.round(((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3_600_000) * 100) / 100;

// --- editing a booking's roster ----------------------------------------------

/**
 * What editing a booking does to its roster. Pure - no database - so the rule
 * can be read, and tested, in one place.
 *
 * Given the shifts the edit may touch (`existing`), the shifts the new pattern
 * describes (`generated`, or null when the pattern is not changing) and the
 * booked caregiver before and after:
 *
 * - An existing shift whose start and end match a generated one exactly is
 *   KEPT - with its note, its own rates and its cover caregiver - so editing a
 *   booking never throws away work done on shifts that still fit.
 * - Every other existing shift is DROPPED (a draft is deleted, a scheduled
 *   shift is cancelled by the caller).
 * - Every generated shift with no match is ADDED, for the booked caregiver.
 * - With no new pattern, everything is kept and nothing is added.
 * - When the booked caregiver changes, kept shifts that were theirs move to
 *   the new one; shifts given to a cover stay with the cover.
 */
export interface PlannableShift {
  id: string;
  caregiverId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface RosterPlan<T extends PlannableShift> {
  keep: { shift: T; caregiverId: string }[];
  drop: T[];
  add: { startsAt: Date; endsAt: Date; caregiverId: string }[];
}

const key = (s: { startsAt: Date; endsAt: Date }) => `${new Date(s.startsAt).getTime()}|${new Date(s.endsAt).getTime()}`;

export function planRoster<T extends PlannableShift>(
  existing: T[],
  generated: { startsAt: Date; endsAt: Date }[] | null,
  bookedCaregiverId: string,
  newBookedCaregiverId: string = bookedCaregiverId,
): RosterPlan<T> {
  const reassign = (s: T) => (s.caregiverId === bookedCaregiverId ? newBookedCaregiverId : s.caregiverId);
  if (!generated) return { keep: existing.map((shift) => ({ shift, caregiverId: reassign(shift) })), drop: [], add: [] };

  // Existing shifts by their exact times; two shifts on one slot (a cover and
  // the booked caregiver) each match one generated slot at most.
  const pool = new Map<string, T[]>();
  for (const s of [...existing].sort((a, b) => Number(a.caregiverId !== bookedCaregiverId) - Number(b.caregiverId !== bookedCaregiverId))) {
    pool.set(key(s), [...(pool.get(key(s)) ?? []), s]);
  }
  const keep: RosterPlan<T>['keep'] = [];
  const add: RosterPlan<T>['add'] = [];
  for (const g of generated) {
    const match = pool.get(key(g))?.shift();
    if (match) keep.push({ shift: match, caregiverId: reassign(match) });
    else add.push({ startsAt: g.startsAt, endsAt: g.endsAt, caregiverId: newBookedCaregiverId });
  }
  const kept = new Set(keep.map((k) => k.shift.id));
  return { keep, drop: existing.filter((s) => !kept.has(s.id)), add };
}

// --- client and caregiver views ---------------------------------------------

/** A shift as the client or caregiver sees it - confirmed shifts only, never drafts. */
export interface PortalShift {
  id: string;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  /** True when someone other than the booked caregiver is covering this shift. */
  isCover: boolean;
}

/** GET /me/bookings (client). */
export interface ClientBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  scheduleType: ScheduleType;
  startDate: string;
  endDate: string;
  rateType: RateType | null;
  rateAmount: string | null;
  caregiverPublicId: string;
  /** Null when the caregiver is not shown on the public site. */
  caregiver: PublicCaregiverProfile | null;
  /** Upcoming and recent (last 7 days) shifts. */
  shifts: PortalShift[];
}

/** GET /me/shifts (caregiver). */
export interface CaregiverShift extends PortalShift {
  bookingReference: string;
  scheduleType: ScheduleType;
  /** Where the care is, as a city/district - the address is shared by staff. */
  area: string | null;
  /** The booking has a care plan the caregiver can open for this shift (GET /me/shifts/:id/care). */
  hasCarePlan: boolean;
}
