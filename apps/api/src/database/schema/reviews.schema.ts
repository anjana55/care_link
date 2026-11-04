import { mysqlTable, varchar, datetime, mysqlEnum, text, tinyint, int, boolean, index, uniqueIndex, primaryKey, json } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { REVIEW_BADGES, REVIEW_COMMENT_STATUSES, REVIEW_LANGUAGES, type BadgeCount } from '@care-platform/shared';

/**
 * A client's rating of one caregiver for one booking - the booked caregiver or
 * a cover who worked a shift on it. One per booking per caregiver, so a long
 * live-in booking is one review, not one a day.
 *
 * Stars and badges count as soon as they are given. The written review
 * (`comment`) is public only once staff approve it. `improvement_tags` and
 * `private_note` are for staff only, never public and never shown to the
 * caregiver. A review staff hide counts for nothing anywhere.
 *
 * When the client's account is erased, the text and private note go and
 * `reviewer_user_id` is cleared; the stars and badges stay, anonymously.
 */
export const caregiverReviews = mysqlTable(
  'caregiver_reviews',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    patientId: varchar('patient_id', { length: 36 }).notNull(),
    reviewerUserId: varchar('reviewer_user_id', { length: 36 }),
    rating: tinyint('rating').notNull(),
    // Comma-separated ReviewImprovementTag codes (private).
    improvementTags: varchar('improvement_tags', { length: 120 }),
    comment: text('comment'),
    commentLanguage: mysqlEnum('comment_language', REVIEW_LANGUAGES),
    commentStatus: mysqlEnum('comment_status', REVIEW_COMMENT_STATUSES).notNull().default('NONE'),
    commentRejectReason: varchar('comment_reject_reason', { length: 300 }),
    commentReviewedByUserId: varchar('comment_reviewed_by_user_id', { length: 36 }),
    commentReviewedAt: datetime('comment_reviewed_at'),
    privateNote: varchar('private_note', { length: 500 }),
    hiddenAt: datetime('hidden_at'),
    hiddenByUserId: varchar('hidden_by_user_id', { length: 36 }),
    hiddenReason: varchar('hidden_reason', { length: 300 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    bookingCaregiverUnique: uniqueIndex('caregiver_reviews_booking_caregiver_unique').on(table.bookingId, table.caregiverId),
    caregiverIdx: index('caregiver_reviews_caregiver_idx').on(table.caregiverId, table.createdAt),
    commentStatusIdx: index('caregiver_reviews_comment_status_idx').on(table.commentStatus, table.createdAt),
    patientIdx: index('caregiver_reviews_patient_idx').on(table.patientId),
  }),
);

/** The praise badges on a review - a row each, so counting them is a GROUP BY. */
export const caregiverReviewBadges = mysqlTable(
  'caregiver_review_badges',
  {
    reviewId: varchar('review_id', { length: 36 }).notNull(),
    badge: mysqlEnum('badge', REVIEW_BADGES).notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: 'caregiver_review_badges_pk', columns: [table.reviewId, table.badge] }),
  }),
);

/**
 * Each caregiver's totals, kept up to date in the same transaction as every
 * review change, so search cards and profiles read one row instead of adding
 * up reviews. Hidden reviews are left out.
 */
export const caregiverRatingStats = mysqlTable('caregiver_rating_stats', {
  caregiverId: varchar('caregiver_id', { length: 36 }).primaryKey(),
  ratingCount: int('rating_count').notNull().default(0),
  ratingSum: int('rating_sum').notNull().default(0),
  badgeCounts: json('badge_counts').$type<BadgeCount[]>().notNull(),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Asking the client to rate: at most one first ask and one reminder per
 * booking and caregiver. The row is the lock - a second sweep, or a second API
 * instance, hits the unique key and skips.
 */
export const reviewRequestStageEnum = ['ASK', 'REMINDER'] as const;
export const reviewRequests = mysqlTable(
  'review_requests',
  {
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    stage: mysqlEnum('stage', reviewRequestStageEnum).notNull(),
    sentAt: datetime('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ name: 'review_requests_pk', columns: [table.bookingId, table.caregiverId, table.stage] }),
  }),
);

/** Settings > Reviews - one row, id 'default', like the other settings. */
export const reviewSettings = mysqlTable('review_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  minRatingsToShow: int('min_ratings_to_show').notNull().default(3),
  windowDays: int('window_days').notNull().default(90),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
