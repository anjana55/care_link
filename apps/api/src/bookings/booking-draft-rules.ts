import { SCHEDULE_PRESETS, addDays, generateShifts, type IsoWeekday, type RateType, type ScheduleType } from '@care-platform/shared';

/**
 * How the booking agent turns a matched request into a first draft booking.
 * Pure rules: the same request always gives the same draft, and when the
 * request does not say enough the answer is "ask a person", never a guess.
 *
 * The draft is a starting point. It is never confirmed by these rules: the
 * hours are the office's usual ones for that kind of schedule, and someone
 * still checks them with the client.
 */

/** A first booking covers this many days; it is extended once the care is under way. */
export const FIRST_BOOKING_DAYS = 14;

export interface DraftInput {
  /** What the client said about hours when they registered. */
  schedule: 'DAY' | 'NIGHT' | 'LIVE_IN_24H' | 'NOT_SURE' | null;
  urgency: 'IMMEDIATELY' | 'WITHIN_WEEK' | 'WITHIN_MONTH' | 'JUST_EXPLORING' | null;
  /** YYYY-MM-DD the client asked to start, if they gave one. */
  desiredStartDate: string | null;
  /** Today in Sri Lanka, YYYY-MM-DD. */
  today: string;
  /** The rates agreed in the accepted offer; any may be missing ("to be agreed"). */
  rateType: RateType | null;
  payRate: number | null;
  clientRate: number | null;
}

export interface BookingDraft {
  scheduleType: Exclude<ScheduleType, 'CUSTOM'>;
  daysOfWeek: IsoWeekday[];
  shiftStartTime: string;
  shiftEndTime: string;
  startDate: string;
  endDate: string;
  shifts: number;
  rateType?: RateType;
  rateAmount?: string;
  payRateType?: RateType;
  payRateAmount?: string;
}

export type DraftResult = { ok: true; draft: BookingDraft; summary: string } | { ok: false; why: string };

const SCHEDULE: Record<string, Exclude<ScheduleType, 'CUSTOM'>> = { DAY: 'DAY', NIGHT: 'NIGHT', LIVE_IN_24H: 'LIVE_IN' };
const WORDS: Record<string, string> = { DAY: 'Day shifts', NIGHT: 'Night shifts', LIVE_IN: 'Live-in care' };

function daysInWords(days: IsoWeekday[]): string {
  if (days.length === 7) return 'every day';
  if (days.join(',') === '1,2,3,4,5') return 'Monday to Friday';
  return `${days.length} days a week`;
}

export function draftBooking(input: DraftInput): DraftResult {
  const scheduleType = input.schedule ? SCHEDULE[input.schedule] : undefined;
  if (!scheduleType) return { ok: false, why: 'the client was not sure what hours they need' };

  const tomorrow = addDays(input.today, 1);
  let startDate: string;
  if (input.desiredStartDate) startDate = input.desiredStartDate > tomorrow ? input.desiredStartDate : tomorrow;
  else if (input.urgency === 'IMMEDIATELY') startDate = tomorrow;
  else return { ok: false, why: 'the request has no start date' };

  const preset = SCHEDULE_PRESETS[scheduleType];
  const endDate = addDays(startDate, FIRST_BOOKING_DAYS - 1);
  const shifts = generateShifts({ startDate, endDate, daysOfWeek: preset.days, shiftStartTime: preset.start, shiftEndTime: preset.end }).length;
  if (!shifts) return { ok: false, why: 'those dates produce no shifts' };

  const draft: BookingDraft = { scheduleType, daysOfWeek: preset.days, shiftStartTime: preset.start, shiftEndTime: preset.end, startDate, endDate, shifts };
  // The same filling-in the booking form does from an accepted offer.
  if (input.rateType && input.payRate !== null) {
    draft.payRateType = input.rateType;
    draft.payRateAmount = input.payRate.toFixed(2);
    if (input.clientRate !== null) {
      draft.rateType = input.rateType;
      draft.rateAmount = input.clientRate.toFixed(2);
    }
  }
  const rates = draft.rateAmount ? 'at the rates agreed in the offer' : draft.payRateAmount ? "at the caregiver's agreed pay; the client's rate is still to be set" : 'rates still to be agreed';
  const summary = `${WORDS[scheduleType]}, ${daysInWords(preset.days)}, ${preset.start}-${preset.end}, from ${startDate} for ${FIRST_BOOKING_DAYS} days (${shifts} shifts), ${rates}`;
  return { ok: true, draft, summary };
}
