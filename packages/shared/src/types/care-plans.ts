import { addDays, colomboToUtc, isValidTime, isoWeekday, toColombo, type IsoWeekday, type ShiftStatus } from './bookings';
import type { CareType } from './care-types';
import { LOCALES, type Locale } from './locale';

/**
 * Care plans: what the caregiver should do for the client on each shift, and
 * the client's tick against each item.
 *
 * - A TEMPLATE is a reusable list of activities kept by staff.
 * - A booking's PLAN starts as a copy of a template (or of the client's last
 *   plan, or blank) and is then tailored. Each plan activity is in force over a
 *   date range, so an edit "from Monday" leaves earlier days exactly as they were.
 * - An OCCURRENCE is one activity due on one shift (once, or once per set time).
 *   Occurrences are worked out here, from the plan and the shift; only outcomes
 *   are stored.
 * - The client marks each occurrence Done or Not done until the CUT-OFF:
 *   midnight (Colombo) at the end of the day the shift ends. Anything still
 *   unmarked then is recorded as Done, by the system (source AUTO).
 *
 * Everything here is pure, so the API, both web apps and the tests apply one rule.
 */

export const careActivityCategoryValues = ['PERSONAL_CARE', 'MEDICATION', 'MOBILITY', 'NUTRITION', 'VITAL_SIGNS', 'HOUSEHOLD', 'COMPANIONSHIP', 'OTHER'] as const;
export type CareActivityCategory = (typeof careActivityCategoryValues)[number];

/** ANY: once, any time in the shift. SLOT: once, in a part of the day. AT_TIMES: once per listed time that falls in the shift. */
export const careActivityTimingValues = ['ANY', 'SLOT', 'AT_TIMES'] as const;
export type CareActivityTiming = (typeof careActivityTimingValues)[number];

export const careSlotValues = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'] as const;
export type CareSlot = (typeof careSlotValues)[number];

/** Colombo wall-clock windows for each slot. NIGHT runs past midnight. */
export const CARE_SLOT_WINDOWS: Record<CareSlot, { start: string; end: string }> = {
  MORNING: { start: '06:00', end: '12:00' },
  AFTERNOON: { start: '12:00', end: '17:00' },
  EVENING: { start: '17:00', end: '21:00' },
  NIGHT: { start: '21:00', end: '06:00' },
};

export const careRecordStatusValues = ['DONE', 'NOT_DONE', 'VOID'] as const;
export type CareRecordStatus = (typeof careRecordStatusValues)[number];
/** Who recorded the outcome: the client, the midnight sweep, or staff correcting it. */
export const careRecordSourceValues = ['CLIENT', 'AUTO', 'STAFF'] as const;
export type CareRecordSource = (typeof careRecordSourceValues)[number];

export const carePlanTemplateStatusValues = ['ACTIVE', 'ARCHIVED'] as const;
export type CarePlanTemplateStatus = (typeof carePlanTemplateStatusValues)[number];

/** Shift statuses on which activities are due. Missed and cancelled shifts have nothing due. */
export const CARE_DUE_SHIFT_STATUSES: readonly ShiftStatus[] = ['SCHEDULED', 'COMPLETED'];

export const MAX_CARE_ACTIVITIES = 60;
export const MAX_CARE_TIMES = 12;
export const MAX_CARE_TITLE = 120;
export const MAX_CARE_INSTRUCTIONS = 1000;
export const MAX_CARE_NOTES = 2000;
export const MAX_CARE_REASON = 300;
/** A caregiver can read a shift's plan from this long before it starts until its cut-off. */
export const CAREGIVER_PLAN_LEAD_HOURS = 24;

/** Text staff write in each language the deployment offers. At least one must be filled. */
export type LocalizedText = Partial<Record<Locale, string>>;

/** The text in `locale`, else the fallback language, else English, else whatever was written. */
export function pickText(text: LocalizedText | null | undefined, locale: Locale, fallback: Locale = 'en'): string {
  if (!text) return '';
  for (const l of [locale, fallback, 'en' as Locale, ...LOCALES]) {
    const v = text[l]?.trim();
    if (v) return v;
  }
  return '';
}

/** Keeps only known languages with something in them. */
export function cleanLocalizedText(text: unknown, max: number): LocalizedText {
  const out: LocalizedText = {};
  if (!text || typeof text !== 'object') return out;
  for (const l of LOCALES) {
    const v = (text as Record<string, unknown>)[l];
    if (typeof v === 'string' && v.trim()) out[l] = v.trim().slice(0, max);
  }
  return out;
}

export const hasText = (text: LocalizedText | null | undefined) => LOCALES.some((l) => Boolean(text?.[l]?.trim()));

/** The fields that say what an activity is and when it is due - shared by templates and plans. */
export interface CareActivityFields {
  category: CareActivityCategory;
  title: LocalizedText;
  instructions: LocalizedText;
  timing: CareActivityTiming;
  /** Set when timing is SLOT. */
  slot: CareSlot | null;
  /** 'HH:MM' Colombo times, set when timing is AT_TIMES. */
  times: string[];
  /** ISO weekdays of the shift's start; null = every shift. */
  daysOfWeek: IsoWeekday[] | null;
  isCritical: boolean;
}

/** Problems with one activity's fields, as message keys - the API and the forms share them. */
export function careActivityProblems(a: Partial<CareActivityFields>): string[] {
  const out: string[] = [];
  if (!a.category || !(careActivityCategoryValues as readonly string[]).includes(a.category)) out.push('category');
  if (!hasText(a.title)) out.push('title');
  if (!a.timing || !(careActivityTimingValues as readonly string[]).includes(a.timing)) out.push('timing');
  if (a.timing === 'SLOT' && (!a.slot || !(careSlotValues as readonly string[]).includes(a.slot))) out.push('slot');
  if (a.timing === 'AT_TIMES' && (!a.times?.length || a.times.length > MAX_CARE_TIMES || a.times.some((t) => !isValidTime(t)) || new Set(a.times).size !== a.times.length)) out.push('times');
  if (a.daysOfWeek && (!a.daysOfWeek.length || a.daysOfWeek.some((d) => !Number.isInteger(d) || d < 1 || d > 7))) out.push('daysOfWeek');
  return out;
}

/** Fields normalised for storage and comparison: sorted times and days, no slot/times that the timing does not use. */
export function normalizeCareActivity<T extends CareActivityFields>(a: T): T {
  return {
    ...a,
    slot: a.timing === 'SLOT' ? a.slot : null,
    times: a.timing === 'AT_TIMES' ? [...new Set(a.times)].sort() : [],
    daysOfWeek: a.daysOfWeek && a.daysOfWeek.length < 7 ? ([...new Set(a.daysOfWeek)].sort((x, y) => x - y) as IsoWeekday[]) : null,
  };
}

/** True when two activities would be due and read the same - an edit that changes nothing. */
export function sameCareActivity(a: CareActivityFields, b: CareActivityFields): boolean {
  const x = normalizeCareActivity(a);
  const y = normalizeCareActivity(b);
  const text = (t: LocalizedText) => JSON.stringify(LOCALES.map((l) => t[l]?.trim() ?? ''));
  return (
    x.category === y.category &&
    text(x.title) === text(y.title) &&
    text(x.instructions) === text(y.instructions) &&
    x.timing === y.timing &&
    x.slot === y.slot &&
    x.times.join(',') === y.times.join(',') &&
    (x.daysOfWeek ?? []).join(',') === (y.daysOfWeek ?? []).join(',') &&
    x.isCritical === y.isCritical
  );
}

// --- occurrences and the cut-off ------------------------------------------------

/** A plan activity as the occurrence rule needs it. */
export interface CareActivityForShift extends Pick<CareActivityFields, 'timing' | 'slot' | 'times' | 'daysOfWeek'> {
  id: string;
  sortOrder: number;
  /** 'YYYY-MM-DD', inclusive. */
  effectiveFrom: string;
  /** 'YYYY-MM-DD', inclusive; null = open-ended. */
  effectiveTo: string | null;
}

export interface CareOccurrence {
  activityId: string;
  /** 'ANY', the slot name, or the 'HH:MM' time - unique for one activity on one shift. */
  dueKey: string;
  /** When it is due, for AT_TIMES; the slot's start (or the shift's start) otherwise - used for ordering. */
  dueAt: Date;
  /** Colombo date it is due on. */
  dueDate: string;
}

const ms = (d: Date | string) => new Date(d).getTime();

/** The Colombo date a shift belongs to: the day it starts. */
export const shiftCareDate = (startsAt: Date | string) => toColombo(startsAt).date;

/**
 * Midnight (Colombo) at the end of the day the shift ends - after which the
 * client can no longer mark it and anything unmarked counts as done. A shift
 * that ends exactly at midnight belongs to the day before.
 */
export function careCutOff(endsAt: Date | string): Date {
  const lastDay = toColombo(new Date(ms(endsAt) - 60_000)).date;
  return colomboToUtc(addDays(lastDay, 1), '00:00');
}

/** Whether the activity is in force on this date, and wanted on its weekday. */
export function careActivityAppliesOn(a: Pick<CareActivityForShift, 'effectiveFrom' | 'effectiveTo' | 'daysOfWeek'>, date: string): boolean {
  if (date < a.effectiveFrom) return false;
  if (a.effectiveTo && date > a.effectiveTo) return false;
  return !a.daysOfWeek || a.daysOfWeek.includes(isoWeekday(date));
}

/**
 * What is due on one shift. The activity is chosen by the day the shift starts
 * (its weekday and the plan in force that day); within the shift:
 * - ANY: one item.
 * - SLOT: one item when the slot's window overlaps the shift at all.
 * - AT_TIMES: one item per time that falls in [start, end) - so a 24-hour
 *   live-in shift from 08:00 has an 08:00 item once, at its start.
 * Ordered by when each is due, then by the plan's order.
 */
export function careOccurrences(activities: CareActivityForShift[], shift: { startsAt: Date | string; endsAt: Date | string }): CareOccurrence[] {
  const start = ms(shift.startsAt);
  const end = ms(shift.endsAt);
  if (!(end > start)) return [];
  const date = shiftCareDate(shift.startsAt);
  const days = [addDays(date, -1), date, addDays(date, 1)];
  const out: (CareOccurrence & { order: number })[] = [];

  for (const a of activities) {
    if (!careActivityAppliesOn(a, date)) continue;
    if (a.timing === 'ANY') {
      out.push({ activityId: a.id, dueKey: 'ANY', dueAt: new Date(start), dueDate: date, order: a.sortOrder });
    } else if (a.timing === 'SLOT' && a.slot) {
      const w = CARE_SLOT_WINDOWS[a.slot];
      for (const d of days) {
        const ws = ms(colomboToUtc(d, w.start));
        const we = ms(colomboToUtc(w.end <= w.start ? addDays(d, 1) : d, w.end));
        if (ws < end && we > start) {
          const at = Math.max(ws, start);
          out.push({ activityId: a.id, dueKey: a.slot, dueAt: new Date(at), dueDate: toColombo(new Date(at)).date, order: a.sortOrder });
          break;
        }
      }
    } else if (a.timing === 'AT_TIMES') {
      for (const time of a.times) {
        if (!isValidTime(time)) continue;
        for (const d of days) {
          const at = ms(colomboToUtc(d, time));
          if (at >= start && at < end) {
            out.push({ activityId: a.id, dueKey: time, dueAt: new Date(at), dueDate: d, order: a.sortOrder });
            break;
          }
        }
      }
    }
  }
  return out
    .sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime() || x.order - y.order || x.dueKey.localeCompare(y.dueKey))
    .map(({ order: _order, ...o }) => o);
}

// --- API shapes --------------------------------------------------------------------

export interface CareActivityView extends CareActivityFields {
  id: string;
  sortOrder: number;
}

export interface CarePlanTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  careTypes: CareType[];
  status: CarePlanTemplateStatus;
  activityCount: number;
  criticalCount: number;
  updatedAt: string;
}

export interface CarePlanTemplateView extends CarePlanTemplateSummary {
  activities: CareActivityView[];
}

/** POST/PATCH a template. Activities are always sent whole, in order. */
export interface CarePlanTemplateInput {
  name: string;
  description?: string | null;
  careTypes: CareType[];
  activities: CareActivityFields[];
}

export interface CarePlanActivityView extends CareActivityView {
  effectiveFrom: string;
  effectiveTo: string | null;
  replacesActivityId: string | null;
}

/** GET /bookings/:id/care-plan (staff). */
export interface CarePlanView {
  id: string;
  bookingId: string;
  sourceTemplate: { id: string; name: string } | null;
  notes: string | null;
  /** In force today or later, in order. */
  activities: CarePlanActivityView[];
  /** Ended activities - what was due before an edit. Newest first. */
  history: CarePlanActivityView[];
  createdAt: string;
  updatedAt: string;
}

/** GET /bookings/:id/care-plan (staff): the plan, if there is one, and the dates an edit may use. */
export interface CarePlanResponse {
  plan: CarePlanView | null;
  today: string;
  /** The date `plan.activities` is shown as of: today, or the latest change already planned. */
  inForceOn: string;
  /** The earliest date a change may take effect. */
  minEffectiveFrom: string;
  /** What the form starts on: tomorrow, the booking's first day, or the earliest allowed - whichever is latest. */
  suggestedEffectiveFrom: string;
  /** From the request the booking came from - narrows the template picker. */
  careType: CareType | null;
  /** Other bookings of the same client that have a plan, to copy from. */
  copyableBookings: { id: string; reference: string; startDate: string }[];
}

/** POST /bookings/:id/care-plan: start from a template, from another of the client's plans, or blank. */
export interface CreateCarePlanInput {
  templateId?: string;
  fromBookingId?: string;
}

/** PUT /bookings/:id/care-plan: the whole list as it should be from `effectiveFrom` on. An `id` keeps an existing activity. */
export interface UpdateCarePlanInput {
  effectiveFrom: string;
  notes?: string | null;
  activities: (CareActivityFields & { id?: string })[];
}

/** One item on a shift's checklist. */
export interface CareChecklistItem {
  activityId: string;
  dueKey: string;
  dueAt: string;
  category: CareActivityCategory;
  title: string;
  instructions: string;
  timing: CareActivityTiming;
  slot: CareSlot | null;
  isCritical: boolean;
  /** Null until marked (or until the cut-off fills it in). */
  status: 'DONE' | 'NOT_DONE' | null;
  source: CareRecordSource | null;
  reason: string | null;
  recordedAt: string | null;
  recordedBy: string | null;
}

export interface CareChecklistShift {
  shiftId: string;
  bookingId: string;
  bookingReference: string;
  startsAt: string;
  endsAt: string;
  shiftStatus: ShiftStatus;
  cutOffAt: string;
  /** Past the cut-off: read-only for the client. */
  locked: boolean;
  /** Whether the client may mark it now (started, not locked, still due). */
  canMark: boolean;
  isCover: boolean;
  caregiverName: string | null;
  planNotes: string | null;
  items: CareChecklistItem[];
}

/** GET /me/care?date= (client). */
export interface ClientCareDay {
  date: string;
  today: string;
  /** Whether the client gets an evening reminder about unmarked items. */
  reminders: boolean;
  shifts: CareChecklistShift[];
}

/** PUT /me/care/records (client) and PUT /bookings/:id/care-log/records (staff, reason required). */
export interface CareRecordInput {
  shiftId: string;
  activityId: string;
  dueKey: string;
  status: 'DONE' | 'NOT_DONE';
  reason?: string | null;
}

/** GET /bookings/:id/care-log?from&to (staff): one entry per shift in range, newest first. */
export interface CareLogResponse {
  from: string;
  to: string;
  shifts: CareChecklistShift[];
  totals: { due: number; done: number; notDone: number; auto: number; open: number; criticalNotConfirmed: number };
}

/** Counts behind the staff dashboard's care items (last 7 days). */
export interface CareAttention {
  criticalNotDone: number;
  criticalUnconfirmed: number;
}
