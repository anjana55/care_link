import type { CareType } from './care-types';
import type { PricingRateType } from './pricing';

/**
 * Job offers: a care request is offered to a caregiver, who accepts or
 * declines in their own time, up to a deadline. Several caregivers can hold
 * an offer for the same request at once; the first to accept takes it and the
 * others are withdrawn.
 *
 * What a caregiver is shown about a job is deliberately little: the kind of
 * care, the area, the start date and the rate. Never the client's name,
 * address, phone number or health details - those come with the booking.
 */

/**
 * JOB: a care request, offered to caregivers who might take it on.
 * COVER: one shift of a running booking whose caregiver cannot come, offered
 * to caregivers who might step in for that shift only.
 */
export const CARE_OFFER_KINDS = ['JOB', 'COVER'] as const;
export type CareOfferKind = (typeof CARE_OFFER_KINDS)[number];

export const CARE_OFFER_STATUSES = ['OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
export type CareOfferStatus = (typeof CARE_OFFER_STATUSES)[number];

export const CARE_OFFER_DECLINE_REASONS = ['NOT_AVAILABLE', 'TOO_FAR', 'RATE_TOO_LOW', 'OTHER'] as const;
export type CareOfferDeclineReason = (typeof CARE_OFFER_DECLINE_REASONS)[number];

/** How long a caregiver has to answer, in minutes. */
export const CARE_OFFER_MINUTES = { default: 24 * 60, min: 10, max: 7 * 24 * 60 } as const;
export const MAX_CARE_OFFER_NOTE = 500;
/** Offers one request can have waiting at the same time. */
export const MAX_OPEN_CARE_OFFERS = 10;

/** An offer that is past its deadline is expired, whether or not the clean-up job has reached it yet. */
export function effectiveCareOfferStatus(status: CareOfferStatus, expiresAt: string | Date, now: Date = new Date()): CareOfferStatus {
  return status === 'OFFERED' && new Date(expiresAt).getTime() <= now.getTime() ? 'EXPIRED' : status;
}

export type LocalPlaceName = { en: string; si: string; ta: string };

/** An offer as the caregiver sees it. */
export interface CaregiverCareOffer {
  id: string;
  kind: CareOfferKind;
  /** The request's reference (or, for cover, the booking's), to quote to the office. */
  reference: string;
  status: CareOfferStatus;
  careType: CareType | null;
  district: LocalPlaceName | null;
  city: LocalPlaceName | null;
  desiredStartDate: string | null;
  /** Cover only: the shift to step in for (ISO instants). Null on a job offer. */
  shift: { startsAt: string; endsAt: string } | null;
  /** What the caregiver would be paid, and per what. Null: to be agreed with the office. */
  rateType: PricingRateType | null;
  payRate: number | null;
  /** A line from the office about the job. */
  note: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

/** An offer as staff see it on the request. */
export interface StaffCareOffer {
  id: string;
  kind: CareOfferKind;
  /** The request a job offer is for; null on a cover offer. */
  requestId: string | null;
  /** The shift a cover offer is for; null on a job offer. */
  shiftId: string | null;
  caregiver: { id: string; fullName: string; registrationNumber: string };
  status: CareOfferStatus;
  rateType: PricingRateType | null;
  payRate: number | null;
  /** What the client would be charged (rate + fee). Null when the rate was entered by hand or is still to be agreed. */
  clientRate: number | null;
  note: string | null;
  declineReason: CareOfferDeclineReason | null;
  sentByName: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
}

export interface SendCareOfferInput {
  caregiverId: string;
  /** Minutes the caregiver has to answer. Default 24 hours. */
  expiresInMinutes?: number;
  note?: string | null;
  /** Only when the caregiver has no usable rate of their own for this kind of care. */
  rateType?: PricingRateType;
  payRate?: number;
}
