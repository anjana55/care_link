import type { ShiftStatus } from './bookings';
import { haversineKm, type GeoPoint } from './geo';

/**
 * Shift check-in: the caregiver arrives, asks the client for the day's
 * four-digit arrival code and enters it; they check out when they leave.
 * It proves the right person reached the right door and records when. Off
 * until an admin switches it on (Settings > Check-in). It never blocks care
 * and never changes a shift's status or what is billed.
 */

export const ARRIVAL_CODE_LENGTH = 4;
/** After this many wrong codes on one shift the caregiver has to ask the office. */
export const CHECK_IN_MAX_WRONG_CODES = 5;
/** A check-in this far from the booking's earlier check-ins is pointed out to staff. */
export const CHECK_IN_FAR_METRES = 300;
/** The client sees a shift's arrival code from this long before it starts. */
export const ARRIVAL_CODE_SHOWN_HOURS = 12;
export const CHECK_IN_NOTE_MAX = 300;

export interface CheckInSettings {
  /** Off: nobody sees a code or a check-in button. */
  enabled: boolean;
  /** How long before the shift starts a caregiver may check in. */
  earlyMinutes: number;
  /** Minutes after the start with no check-in before staff are told. */
  lateAfterMinutes: number;
}

export const DEFAULT_CHECK_IN_SETTINGS: CheckInSettings = { enabled: false, earlyMinutes: 60, lateAfterMinutes: 15 };
export const CHECK_IN_SETTINGS_LIMITS = { earlyMinutes: { min: 0, max: 240 }, lateAfterMinutes: { min: 5, max: 120 } } as const;

/**
 * Where one visit stands:
 *  UPCOMING - too early to check in;  DUE - check-in is open;
 *  LATE - started a while ago with nobody checked in;
 *  IN - the caregiver is there;  OUT - they have left;
 *  NOT_RECORDED - the shift ended with no check-in.
 */
export type VisitState = 'UPCOMING' | 'DUE' | 'LATE' | 'IN' | 'OUT' | 'NOT_RECORDED';

interface VisitTimes {
  startsAt: Date | string;
  endsAt: Date | string;
  checkedInAt: Date | string | null;
  checkedOutAt: Date | string | null;
}

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

export function visitState(visit: VisitTimes, settings: Pick<CheckInSettings, 'earlyMinutes' | 'lateAfterMinutes'>, now: Date = new Date()): VisitState {
  if (visit.checkedOutAt) return 'OUT';
  if (visit.checkedInAt) return 'IN';
  const t = now.getTime();
  const start = ms(visit.startsAt);
  if (t < start - settings.earlyMinutes * 60_000) return 'UPCOMING';
  if (t >= ms(visit.endsAt)) return 'NOT_RECORDED';
  // A shift shorter than the grace period is late once it is half over.
  const grace = Math.min(settings.lateAfterMinutes * 60_000, (ms(visit.endsAt) - start) / 2);
  return t < start + grace ? 'DUE' : 'LATE';
}

/** A caregiver can check in while the visit is due or late - not before, and not after the shift has ended. */
export const checkInOpen = (state: VisitState) => state === 'DUE' || state === 'LATE';

/** Whole minutes since the shift started, for a visit that is late. */
export function minutesLate(visit: Pick<VisitTimes, 'startsAt'>, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - ms(visit.startsAt)) / 60_000));
}

/** The client is shown the code from a few hours before the shift until the caregiver checks in or the shift ends. */
export function arrivalCodeShown(visit: VisitTimes, now: Date = new Date()): boolean {
  const t = now.getTime();
  return !visit.checkedInAt && t >= ms(visit.startsAt) - ARRIVAL_CODE_SHOWN_HOURS * 3_600_000 && t < ms(visit.endsAt);
}

/** Distance between two points on the ground, in whole metres. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  return Math.round(haversineKm(a, b) * 1000);
}

/** A caregiver's own view of a shift's check-in (on GET /me/shifts). Null on the shift when check-in is off. */
export interface CaregiverCheckIn {
  state: VisitState;
  /** When check-in opens for this shift. */
  opensAt: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  /** Too many wrong codes: only the office can check them in now. */
  codeLocked: boolean;
}

/** A client's view of one visit (on a shift in GET /me/bookings). Null when check-in is off. */
export interface ClientVisit {
  /** The code to read to the caregiver at the door; null when it is not the time to show it. */
  arrivalCode: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
}

export type CheckInBy = 'CAREGIVER' | 'STAFF';

/** Staff's view of a visit's check-in. */
export interface StaffCheckIn {
  state: VisitState;
  arrivalCode: string;
  wrongCodes: number;
  codeLocked: boolean;
  checkedInAt: string | null;
  inBy: CheckInBy | null;
  inByName: string | null;
  inNote: string | null;
  inLocation: (GeoPoint & { accuracyM: number | null }) | null;
  /** Metres from the booking's first located check-in; null when there is nothing to compare. */
  inDistanceM: number | null;
  checkedOutAt: string | null;
  outBy: CheckInBy | null;
  outByName: string | null;
  outNote: string | null;
  outLocation: (GeoPoint & { accuracyM: number | null }) | null;
}

/** GET /visits/today (staff): every visit on today's roster, in time order. */
export interface TodayVisit {
  shiftId: string;
  bookingId: string;
  bookingReference: string;
  startsAt: string;
  endsAt: string;
  shiftStatus: ShiftStatus;
  client: { id: string; fullName: string; recipientName: string | null; area: string | null };
  caregiver: { id: string; fullName: string; registrationNumber: string; phone: string | null };
  isCover: boolean;
  /** Minutes since the start, when nobody has checked in and it is late. */
  minutesLate: number | null;
  checkIn: StaffCheckIn;
}

export interface TodayVisits {
  settings: CheckInSettings;
  /** Today in Sri Lanka, YYYY-MM-DD. */
  date: string;
  visits: TodayVisit[];
}

/** POST /me/shifts/:id/check-in (caregiver). The position is optional: a phone that cannot give one still checks in. */
export interface CheckInInput {
  code: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
}

/** POST /visits/:shiftId/check-in and /check-out (staff, on the caregiver's behalf). */
export interface StaffCheckInInput {
  /** When it happened, if not now (ISO). Never in the future. */
  at?: string;
  note?: string;
}
