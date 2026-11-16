import type { CareType } from './care-types';

/**
 * Intake: what a care request needs before caregivers can be found and a
 * booking drafted, and asking the client for what is missing.
 *
 * Exact rules, no AI: a request is complete when it says what kind of care,
 * where, at what time of day, and from which date. A client who said they are
 * "just exploring" is not chased.
 */
export const INTAKE_GAPS = ['CARE_TYPE', 'AREA', 'SCHEDULE', 'START_DATE'] as const;
export type IntakeGap = (typeof INTAKE_GAPS)[number];

/** The times of day care can be asked for. NOT_SURE is allowed at sign-up but is a gap for a request. */
export const REQUEST_SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
export type RequestSchedule = (typeof REQUEST_SCHEDULES)[number];

/** Hours the client has to answer before the request goes back to staff. */
export const INTAKE_ANSWER_HOURS = 48;
/** How far ahead a start date can be. */
export const INTAKE_MAX_START_DAYS = 365;

export interface IntakeFacts {
  careType: string | null;
  districtId: number | null;
  schedule: string | null;
  desiredStartDate: string | null;
  /** How soon they said they need care (from sign-up). */
  urgency: string | null;
}

/** What the request is missing, in a fixed order. Empty when it is complete, or when the client is just exploring. */
export function requestGaps(r: IntakeFacts): IntakeGap[] {
  if (r.urgency === 'JUST_EXPLORING') return [];
  const gaps: IntakeGap[] = [];
  if (!r.careType) gaps.push('CARE_TYPE');
  if (r.districtId === null || r.districtId === undefined) gaps.push('AREA');
  if (!r.schedule || r.schedule === 'NOT_SURE') gaps.push('SCHEDULE');
  if (!r.desiredStartDate) gaps.push('START_DATE');
  return gaps;
}

/** PATCH /me/care-requests/:id/details (client). Only what was asked for is required. */
export interface ClientRequestDetailsInput {
  careType?: CareType;
  districtId?: number;
  cityId?: number | null;
  schedule?: Exclude<RequestSchedule, 'NOT_SURE'>;
  desiredStartDate?: string;
}

/** Staff view of where intake stands on a request. */
export interface RequestIntake {
  /** What is still missing now. */
  gaps: IntakeGap[];
  /** What the client was asked for, and when; null when they have not been asked. */
  asked: { gaps: IntakeGap[]; at: string } | null;
  answeredAt: string | null;
}
