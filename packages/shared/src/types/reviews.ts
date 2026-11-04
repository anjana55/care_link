import { z } from 'zod';
import type { PublicCaregiverProfile } from './public-search';

/**
 * Caregiver ratings and reviews.
 *
 * A client rates each caregiver who worked a shift on their booking - the
 * booked caregiver and any cover - once per booking: 1-5 stars, praise badges
 * when they give 4 or 5 (like Uber's compliments), private "could be better"
 * tags when they give 1-3, an optional written review (public once staff
 * approve it) and an optional private note to the office.
 *
 * Stars and badges count at once. The average is shown publicly only once a
 * caregiver has enough ratings (Settings > Reviews), so one early rating can't
 * define a new caregiver. Reviewers are never named in public: a review reads
 * "Client · <district>".
 */

export const REVIEW_BADGES = [
  'PUNCTUAL',
  'KIND_PATIENT',
  'CLEAN_TIDY',
  'SKILLED_CARE',
  'SAFE_HANDLING',
  'GOOD_COMMUNICATION',
  'RESPECTFUL',
  'TRUSTWORTHY',
  'GOOD_COOK',
  'EXTRA_MILE',
] as const;
export type ReviewBadge = (typeof REVIEW_BADGES)[number];

/** Private feedback for staff when the client gives 1-3 stars. Never public, never shown to the caregiver. */
export const REVIEW_IMPROVEMENT_TAGS = ['TIMEKEEPING', 'COMMUNICATION', 'HYGIENE', 'CARE_QUALITY', 'ATTITUDE', 'OTHER'] as const;
export type ReviewImprovementTag = (typeof REVIEW_IMPROVEMENT_TAGS)[number];

/**
 * The written review's state. NONE: no text. PENDING: waiting for staff.
 * APPROVED: public. REJECTED: not shown; the client is told why and may edit it.
 */
export const REVIEW_COMMENT_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewCommentStatus = (typeof REVIEW_COMMENT_STATUSES)[number];

export const REVIEW_LANGUAGES = ['en', 'si', 'ta'] as const;
export type ReviewLanguage = (typeof REVIEW_LANGUAGES)[number];

/** Badges are offered from this many stars up; "could be better" tags below it. */
export const PRAISE_MIN_RATING = 4;
/** Ratings at or below this alert staff for a follow-up call. */
export const LOW_RATING_MAX = 2;

export const MIN_REVIEW_COMMENT = 10;
export const MAX_REVIEW_COMMENT = 1000;
export const MAX_REVIEW_PRIVATE_NOTE = 500;
export const MAX_REVIEW_REASON = 300;

/** Defaults for Settings > Reviews. */
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { enabled: true, minRatingsToShow: 3, windowDays: 90 };
export const REVIEW_SETTINGS_LIMITS = { minRatingsToShow: { min: 1, max: 20 }, windowDays: { min: 7, max: 365 } } as const;

/** Reviews per page on a public profile. */
export const PUBLIC_REVIEWS_PAGE_SIZE = 10;

export interface ReviewSettings {
  /** Off: no new ratings, and none shown publicly (existing ones are kept). */
  enabled: boolean;
  /** Ratings a caregiver needs before the average is shown publicly. */
  minRatingsToShow: number;
  /** Days after the caregiver's last shift on a booking that the client can still rate or edit. */
  windowDays: number;
}

// --- contact details in review text --------------------------------------------

/**
 * Contact goes through the office, so a review may not carry a phone number,
 * an email address or a link. Shared so the website and the app warn before
 * sending; the API checks again.
 */
export type ContactDetailKind = 'phone' | 'email' | 'link';

const PHONE_RE = /(?:\+?\d[\s\-().]*){9,}/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|lk|net|org|info|me|io|co)\b(?:\/\S*)?|\bwa\.me\/\S+/i;

export function findContactDetails(text: string | null | undefined): ContactDetailKind | null {
  if (!text) return null;
  if (EMAIL_RE.test(text)) return 'email';
  if (LINK_RE.test(text)) return 'link';
  if (PHONE_RE.test(text)) return 'phone';
  return null;
}

/** The language a review is written in, from its script: Sinhala, Tamil, or else English. */
export function detectReviewLanguage(text: string): ReviewLanguage {
  let si = 0;
  let ta = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0d80 && c <= 0x0dff) si++;
    else if (c >= 0x0b80 && c <= 0x0bff) ta++;
  }
  if (!si && !ta) return 'en';
  return si >= ta ? 'si' : 'ta';
}

/** The average shown to people: one decimal place. */
export const roundRating = (sum: number, count: number) => (count ? Math.round((sum / count) * 10) / 10 : 0);

// --- submitting ---------------------------------------------------------------

/** PUT /me/bookings/:bookingId/reviews/:caregiverPublicId */
export const reviewSubmitSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    badges: z.array(z.enum(REVIEW_BADGES)).max(REVIEW_BADGES.length).default([]),
    improvementTags: z.array(z.enum(REVIEW_IMPROVEMENT_TAGS)).max(REVIEW_IMPROVEMENT_TAGS.length).default([]),
    comment: z.string().trim().max(MAX_REVIEW_COMMENT).nullish(),
    privateNote: z.string().trim().max(MAX_REVIEW_PRIVATE_NOTE).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.rating < PRAISE_MIN_RATING && v.badges.length) ctx.addIssue({ code: 'custom', path: ['badges'], message: 'badgesNeedHighRating' });
    if (v.rating >= PRAISE_MIN_RATING && v.improvementTags.length) ctx.addIssue({ code: 'custom', path: ['improvementTags'], message: 'tagsNeedLowRating' });
    if (v.comment && v.comment.length < MIN_REVIEW_COMMENT) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'commentTooShort' });
    if (findContactDetails(v.comment)) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'contactDetails' });
  });
export type ReviewSubmitBody = z.input<typeof reviewSubmitSchema>;

// --- views --------------------------------------------------------------------

export interface BadgeCount {
  badge: ReviewBadge;
  count: number;
}

/** On search cards and profiles. Null until the caregiver has enough ratings to show. */
export interface CaregiverRatingSummary {
  /** One decimal place. */
  average: number;
  count: number;
  /** Most-given badges first (up to 3 on a profile summary). */
  topBadges: BadgeCount[];
}

/** One review as anyone may see it. The reviewer is never named. */
export interface PublicReview {
  id: string;
  rating: number;
  badges: ReviewBadge[];
  /** Approved text only; null when there is none (or it isn't approved yet). */
  comment: string | null;
  commentLanguage: ReviewLanguage | null;
  /** The client's district, in the reader's language: "Client · Kandy district". */
  reviewerDistrict: string | null;
  /** 'YYYY-MM' - month and year only. */
  month: string;
}

/** GET /public/caregivers/:publicId/reviews */
export interface PublicReviewsPage {
  summary: CaregiverRatingSummary | null;
  /** Every badge the caregiver has received, most first (empty below the threshold). */
  badgeCounts: BadgeCount[];
  /** Reviews with approved text, newest first. */
  items: PublicReview[];
  total: number;
  page: number;
  pageSize: number;
}

/** The client's own review, with everything they wrote. */
export interface MyReview {
  id: string;
  bookingId: string;
  caregiverPublicId: string;
  rating: number;
  badges: ReviewBadge[];
  improvementTags: ReviewImprovementTag[];
  comment: string | null;
  commentStatus: ReviewCommentStatus;
  /** Why staff did not publish the text, when they didn't. */
  commentRejectReason: string | null;
  privateNote: string | null;
  /** Staff hid the review (abuse, wrong person). It counts for nothing; it can be deleted, not edited. */
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A caregiver the client can rate (or has rated) on one booking. */
export interface ReviewableCaregiver {
  bookingId: string;
  bookingReference: string;
  caregiverPublicId: string;
  /** Null when the caregiver is no longer shown on the public site. */
  caregiver: PublicCaregiverProfile | null;
  /** Worked shifts as a cover, not the booked caregiver. */
  isCover: boolean;
  /** When their last worked shift on the booking ended (ISO). */
  lastWorkedAt: string;
  /** Rating and editing close after this (ISO). */
  reviewUntil: string;
  /** The window is open (and reviews are switched on). */
  canReview: boolean;
  review: MyReview | null;
}

/** GET /me/reviews (caregiver): their own ratings. */
export interface CaregiverOwnRatings {
  /** Their average and count, even below the public threshold - it's theirs. Null with no ratings. */
  summary: { average: number; count: number } | null;
  /** Whether the average is shown on their public profile yet. */
  shownPublicly: boolean;
  minRatingsToShow: number;
  badgeCounts: BadgeCount[];
  /** Approved written reviews, newest first. */
  reviews: PublicReview[];
}

// --- staff ----------------------------------------------------------------------

export const STAFF_REVIEW_FILTERS = ['pending', 'low', 'hidden', 'all'] as const;
export type StaffReviewFilter = (typeof STAFF_REVIEW_FILTERS)[number];

export interface StaffReview {
  id: string;
  bookingId: string;
  bookingReference: string;
  caregiverId: string;
  caregiverName: string;
  caregiverPublicId: string;
  patientId: string;
  clientName: string;
  rating: number;
  badges: ReviewBadge[];
  improvementTags: ReviewImprovementTag[];
  comment: string | null;
  commentLanguage: ReviewLanguage | null;
  commentStatus: ReviewCommentStatus;
  commentRejectReason: string | null;
  commentReviewedBy: string | null;
  commentReviewedAt: string | null;
  privateNote: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffReviewList {
  items: StaffReview[];
  total: number;
  page: number;
  pageSize: number;
  /** For the tab badges. */
  counts: { pending: number; low: number; hidden: number };
}

/** A caregiver's ratings for staff: everything, including private feedback. */
export interface StaffCaregiverRatings {
  summary: { average: number; count: number } | null;
  shownPublicly: boolean;
  badgeCounts: BadgeCount[];
  improvementCounts: { tag: ReviewImprovementTag; count: number }[];
  reviews: StaffReview[];
}
