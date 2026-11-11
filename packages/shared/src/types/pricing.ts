import { careTypeValues, type CareType } from './care-types';

/**
 * Caregiver-set rates (Settings > Rates and fees).
 *
 * For each kind of care the admin sets how it is priced (per hour, day or
 * month), the band a caregiver's own rate must stay within, and the platform
 * fee. A caregiver then names their rate for each kind of care they take on.
 * The client is shown one all-in price: the caregiver's rate plus the fee.
 *
 * Amounts are in LKR. One definition shared by the API, the staff app, the
 * website and the mobile app, so a price is worked out the same way everywhere.
 */

export const pricingRateTypeValues = ['HOURLY', 'DAILY', 'MONTHLY'] as const;
export type PricingRateType = (typeof pricingRateTypeValues)[number];

export interface CareTypePricing {
  careType: CareType;
  /** Caregivers may set their own rate for this kind of care. Off until the admin has set a band. */
  enabled: boolean;
  rateType: PricingRateType;
  /** The lowest and highest rate a caregiver may ask. */
  minRate: number;
  maxRate: number;
  /** Added to the caregiver's rate to make the client's price, 0-100. */
  feePercent: number;
}

/** How each kind of care is priced until the admin says otherwise. */
export const DEFAULT_RATE_TYPES: Record<CareType, PricingRateType> = {
  HOME_SHIFT: 'DAILY',
  LIVE_IN: 'MONTHLY',
  HOSPITAL: 'DAILY',
  NURSING_HOME: 'DAILY',
  RETIREMENT_HOME: 'DAILY',
};

export function defaultPricing(careType: CareType): CareTypePricing {
  return { careType, enabled: false, rateType: DEFAULT_RATE_TYPES[careType], minRate: 0, maxRate: 0, feePercent: 0 };
}

export const MAX_RATE_LKR = 10_000_000;
export const MAX_FEE_PERCENT = 100;

/**
 * The client's all-in price for a caregiver's rate: the rate plus the fee,
 * rounded to a whole rupee (halves up) so nobody is quoted cents.
 */
export function clientPriceFor(rate: number, feePercent: number): number {
  return Math.round((rate * (100 + feePercent)) / 100 + Number.EPSILON);
}

/** Why a rate is not acceptable, or null when it is. Used by the API and by the forms before they send. */
export function rateProblem(amount: number, pricing: Pick<CareTypePricing, 'enabled' | 'minRate' | 'maxRate'>): 'DISABLED' | 'NOT_A_NUMBER' | 'TOO_LOW' | 'TOO_HIGH' | null {
  if (!pricing.enabled) return 'DISABLED';
  if (!Number.isFinite(amount) || amount <= 0) return 'NOT_A_NUMBER';
  if (amount < pricing.minRate) return 'TOO_LOW';
  if (amount > pricing.maxRate) return 'TOO_HIGH';
  return null;
}

/** One line of a caregiver's rate card: a kind of care, what they ask, and what the client would pay. */
export interface CaregiverRateLine {
  careType: CareType;
  /** The caregiver takes on this kind of care (their availability). */
  offered: boolean;
  /** How this kind of care is priced, its band and whether own rates are switched on. */
  pricing: CareTypePricing;
  /** The caregiver's rate. Null: not set. */
  amount: number | null;
  /** Rate plus fee. Null while no rate is set. */
  clientPrice: number | null;
  /** The stored rate has fallen outside the band since it was set (the admin moved the band). */
  outOfBand: boolean;
  updatedAt: string | null;
}

export interface CaregiverRateCard {
  caregiverId: string;
  lines: CaregiverRateLine[];
}

/** What a booking for this caregiver and kind of care would be priced at. */
export interface RateQuote {
  careType: CareType;
  rateType: PricingRateType;
  /** What the caregiver is paid. */
  payRate: number;
  feePercent: number;
  /** What the client is charged. */
  clientRate: number;
}

export { careTypeValues as pricingCareTypes };
