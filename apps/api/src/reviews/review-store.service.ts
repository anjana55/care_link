import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull, lte, ne, sum } from 'drizzle-orm';
import type { BadgeCount, MyReview, PublicCaregiverProfile, ReviewBadge, ReviewableCaregiver } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, caregiverRatingStats, caregiverReviewBadges, caregiverReviews, caregivers } from '../database/schema';
import { parseTags, sortBadgeCounts, workedWindows, type RatingStats, type WorkedWindow } from './review-rules';

type ReviewRow = typeof caregiverReviews.$inferSelect;

export interface BookingReviewEntry extends WorkedWindow {
  bookingId: string;
  bookingReference: string;
  caregiverPublicId: string;
  review: MyReview | null;
}

/** What the client sees for one caregiver on one booking. */
export function reviewableView(e: BookingReviewEntry, caregiver: PublicCaregiverProfile | null, enabled: boolean): ReviewableCaregiver {
  return {
    bookingId: e.bookingId,
    bookingReference: e.bookingReference,
    caregiverPublicId: e.caregiverPublicId,
    caregiver,
    isCover: e.isCover,
    lastWorkedAt: e.lastWorkedAt.toISOString(),
    reviewUntil: e.reviewUntil.toISOString(),
    canReview: enabled && e.open,
    review: e.review,
  };
}

/**
 * The reads and writes every part of the platform needs about ratings -
 * search and profiles (totals), bookings (who the client can rate), and the
 * reviews module itself. It only touches the database, so search and bookings
 * can use it without depending on the reviews module.
 */
@Injectable()
export class ReviewStore {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Each caregiver's totals, keyed by internal id. Caregivers with no ratings are absent. */
  async statsFor(caregiverIds: string[]): Promise<Map<string, RatingStats>> {
    const ids = [...new Set(caregiverIds)];
    if (!ids.length) return new Map();
    const rows = await this.db.select().from(caregiverRatingStats).where(inArray(caregiverRatingStats.caregiverId, ids));
    return new Map(rows.map((r) => [r.caregiverId, { ratingCount: r.ratingCount, ratingSum: r.ratingSum, badgeCounts: sortBadgeCounts(r.badgeCounts ?? []) }]));
  }

  /** Adds a caregiver's totals up again from their visible reviews. Call inside the transaction that changed a review. */
  async recompute(db: Database, caregiverId: string): Promise<void> {
    const visible = and(eq(caregiverReviews.caregiverId, caregiverId), isNull(caregiverReviews.hiddenAt));
    const [totals] = await db.select({ n: count(), total: sum(caregiverReviews.rating) }).from(caregiverReviews).where(visible);
    const badges = await db
      .select({ badge: caregiverReviewBadges.badge, n: count() })
      .from(caregiverReviewBadges)
      .innerJoin(caregiverReviews, eq(caregiverReviewBadges.reviewId, caregiverReviews.id))
      .where(visible)
      .groupBy(caregiverReviewBadges.badge);
    const badgeCounts: BadgeCount[] = sortBadgeCounts(badges.map((b) => ({ badge: b.badge, count: Number(b.n) })));
    const ratingCount = Number(totals?.n ?? 0);
    const ratingSum = Number(totals?.total ?? 0);
    if (!ratingCount) {
      await db.delete(caregiverRatingStats).where(eq(caregiverRatingStats.caregiverId, caregiverId));
      return;
    }
    await db
      .insert(caregiverRatingStats)
      .values({ caregiverId, ratingCount, ratingSum, badgeCounts, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { ratingCount, ratingSum, badgeCounts, updatedAt: new Date() } });
  }

  /** Badges on a set of reviews, keyed by review id. */
  async badgesFor(reviewIds: string[], db: Database = this.db): Promise<Map<string, ReviewBadge[]>> {
    const out = new Map<string, ReviewBadge[]>();
    if (!reviewIds.length) return out;
    const rows = await db.select().from(caregiverReviewBadges).where(inArray(caregiverReviewBadges.reviewId, reviewIds));
    for (const r of rows) out.set(r.reviewId, [...(out.get(r.reviewId) ?? []), r.badge]);
    for (const [id, list] of out) out.set(id, sortBadgeCounts(list.map((badge) => ({ badge, count: 1 }))).map((b) => b.badge));
    return out;
  }

  toMyReview(r: ReviewRow, badges: ReviewBadge[], caregiverPublicId: string): MyReview {
    return {
      id: r.id,
      bookingId: r.bookingId,
      caregiverPublicId,
      rating: r.rating,
      badges,
      improvementTags: parseTags(r.improvementTags),
      comment: r.comment,
      commentStatus: r.commentStatus,
      commentRejectReason: r.commentStatus === 'REJECTED' ? r.commentRejectReason : null,
      privateNote: r.privateNote,
      hidden: Boolean(r.hiddenAt),
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    };
  }

  /**
   * For one client's bookings: everyone who has worked a shift on each, their
   * rating window, and the client's review of them. Bookings with nobody who
   * has worked yet are absent.
   */
  async entriesForClient(patientId: string, bookingIds: string[], now: Date, windowDays: number): Promise<Map<string, BookingReviewEntry[]>> {
    const out = new Map<string, BookingReviewEntry[]>();
    if (!bookingIds.length) return out;
    const [rows, shifts, reviews] = await Promise.all([
      this.db
        .select({ id: bookings.id, reference: bookings.reference, caregiverId: bookings.caregiverId })
        .from(bookings)
        .where(and(inArray(bookings.id, bookingIds), eq(bookings.patientId, patientId), ne(bookings.status, 'DRAFT'))),
      this.db
        .select({ bookingId: bookingShifts.bookingId, caregiverId: bookingShifts.caregiverId, startsAt: bookingShifts.startsAt, endsAt: bookingShifts.endsAt, status: bookingShifts.status })
        .from(bookingShifts)
        .where(and(inArray(bookingShifts.bookingId, bookingIds), inArray(bookingShifts.status, ['SCHEDULED', 'COMPLETED']))),
      this.db.select().from(caregiverReviews).where(and(eq(caregiverReviews.patientId, patientId), inArray(caregiverReviews.bookingId, bookingIds))),
    ]);
    const caregiverIds = [...new Set(shifts.map((s) => s.caregiverId))];
    const [publicIds, badges] = await Promise.all([
      caregiverIds.length
        ? this.db.select({ id: caregivers.id, publicId: caregivers.publicId }).from(caregivers).where(inArray(caregivers.id, caregiverIds))
        : Promise.resolve([] as { id: string; publicId: string }[]),
      this.badgesFor(reviews.map((r) => r.id)),
    ]);
    const publicIdOf = new Map(publicIds.map((c) => [c.id, c.publicId]));
    for (const b of rows) {
      const windows = workedWindows(
        shifts.filter((s) => s.bookingId === b.id),
        b.caregiverId,
        now,
        windowDays,
      );
      const entries = windows.flatMap((w) => {
        const publicId = publicIdOf.get(w.caregiverId);
        if (!publicId) return [];
        const r = reviews.find((x) => x.bookingId === b.id && x.caregiverId === w.caregiverId);
        return [{ ...w, bookingId: b.id, bookingReference: b.reference, caregiverPublicId: publicId, review: r ? this.toMyReview(r, badges.get(r.id) ?? [], publicId) : null }];
      });
      if (entries.length) out.set(b.id, entries);
    }
    return out;
  }

  /** Booking ids of a client's bookings that anyone has worked on (for the pending list). */
  async clientBookingIds(patientId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: bookings.id })
      .from(bookings)
      .innerJoin(bookingShifts, eq(bookingShifts.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.patientId, patientId),
          ne(bookings.status, 'DRAFT'),
          inArray(bookingShifts.status, ['SCHEDULED', 'COMPLETED']),
          lte(bookingShifts.endsAt, new Date()),
        ),
      )
      .limit(200);
    return rows.map((r) => r.id);
  }
}
