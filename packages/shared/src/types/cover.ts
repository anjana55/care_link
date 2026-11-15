import type { PricingRateType } from './pricing';
import type { StaffCareOffer } from './care-offers';

/**
 * Cover: one shift of a running booking whose caregiver cannot come is
 * offered to other caregivers; the first to accept is put on the shift. The
 * client's price does not change, and the cover is paid what the shift pays.
 *
 * A caregiver offered cover is shown the day and time, the area and the pay -
 * never the client's name, address, phone number or health details. Those
 * come with the shift once they have accepted it.
 */

/** How long a caregiver has to answer a cover offer, by how soon the shift is. */
export const COVER_OFFER_MINUTES = {
  /** The shift has started, or starts within two hours. */
  live: 15,
  /** It starts within a day. */
  soon: 60,
  /** It is further off. */
  later: 240,
} as const;

/** Cover offers one shift can have waiting at the same time. */
export const MAX_OPEN_COVER_OFFERS = 5;
/** The most caregivers one "send" can offer a shift to. */
export const MAX_COVER_OFFERS_PER_SEND = 5;

const ms = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

/**
 * The time to answer a cover offer sent now: short when the shift is close,
 * and never past the shift's end.
 */
export function coverOfferMinutes(shift: { startsAt: Date | string; endsAt: Date | string }, now: Date = new Date()): number {
  const toStart = (ms(shift.startsAt) - now.getTime()) / 60_000;
  const toEnd = Math.floor((ms(shift.endsAt) - now.getTime()) / 60_000);
  const want = toStart <= 120 ? COVER_OFFER_MINUTES.live : toStart <= 24 * 60 ? COVER_OFFER_MINUTES.soon : COVER_OFFER_MINUTES.later;
  return Math.max(1, Math.min(want, toEnd));
}

/**
 * Why a shift cannot be offered as cover:
 * - NOT_SCHEDULED  it is a draft, done, missed or cancelled
 * - ENDED          its time is over
 * - CHECKED_IN     the caregiver is there
 * - BILLED         it is already on an invoice or a pay statement, so the caregiver is changed with a correction
 */
export type CoverBlock = 'NOT_SCHEDULED' | 'ENDED' | 'CHECKED_IN' | 'BILLED';

/** A caregiver who could cover, as staff see them. */
export interface CoverSuggestion {
  caregiverId: string;
  fullName: string;
  registrationNumber: string;
  phone: string | null;
  score: number;
  /** Why they are placed where they are, in plain words. */
  reasons: string[];
}

/** GET /visits/:shiftId/cover (staff): one shift, who has been offered it, and who else could take it. */
export interface ShiftCover {
  shiftId: string;
  bookingId: string;
  bookingReference: string;
  startsAt: string;
  endsAt: string;
  /** Who is on the shift now. */
  caregiver: { id: string; fullName: string; registrationNumber: string };
  /** True when the shift is already with someone other than the booked caregiver. */
  isCover: boolean;
  /** Null when cover offers can be sent. */
  blocked: CoverBlock | null;
  /** The invoice or pay statement that blocks it, in words. */
  blockedBy: string | null;
  /** What the shift pays, shown to the caregivers it is offered to. Null: to be agreed with the office. */
  pay: { rateType: PricingRateType; amount: number } | null;
  /** Minutes a caregiver would get to answer an offer sent now. */
  offerMinutes: number;
  /** Newest first. */
  offers: StaffCareOffer[];
  /** Best first; nobody who is busy then, or who already has or had an offer for this shift. */
  suggestions: CoverSuggestion[];
}

/** POST /visits/:shiftId/cover/offers (staff). */
export interface SendCoverOffersInput {
  caregiverIds: string[];
  /** Minutes to answer. Default: by how soon the shift is (coverOfferMinutes). */
  expiresInMinutes?: number;
  note?: string | null;
}
