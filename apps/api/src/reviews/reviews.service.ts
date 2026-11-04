import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, isNotNull, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  LOW_RATING_MAX,
  MIN_REVIEW_COMMENT,
  PRAISE_MIN_RATING,
  PUBLIC_CAREGIVER_STATUSES,
  PUBLIC_REVIEWS_PAGE_SIZE,
  detectReviewLanguage,
  findContactDetails,
  resolveLocale,
  roundRating,
  type CaregiverOwnRatings,
  type Locale,
  type PublicReview,
  type PublicReviewsPage,
  type ReviewableCaregiver,
  type StaffCaregiverRatings,
  type StaffReview,
  type StaffReviewList,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingEvents, bookings, caregiverReviewBadges, caregiverReviews, caregivers, districts, patients, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PublicSearchService } from '../public-search/public-search.service';
import { ReviewSettingsService } from './review-settings.service';
import { ReviewStore, reviewableView, type BookingReviewEntry } from './review-store.service';
import { ReviewsNotifier } from './reviews-notifier.service';
import { formatTags, parseTags, publicSummary, shownPublicly, sortBadgeCounts } from './review-rules';
import type { ReviewReasonDto, StaffReviewQueryDto, SubmitReviewDto } from './dto/review.dto';

type Tx = Database;
type ReviewRow = typeof caregiverReviews.$inferSelect;

const STARS = (n: number) => `${n} star${n === 1 ? '' : 's'}`;

/**
 * Clients rating the caregivers who cared for them; the public, caregivers and
 * staff reading those ratings; and staff moderating the written reviews.
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: ReviewSettingsService,
    private readonly store: ReviewStore,
    private readonly publicSearch: PublicSearchService,
    private readonly notifier: ReviewsNotifier,
  ) {}

  // --- clients -----------------------------------------------------------------------

  private patientIdOf(user: AuthenticatedUser): string {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) throw new ForbiddenException('You do not have permission to perform this action');
    return user.patientId;
  }

  /** Adds each caregiver's public profile, for showing who the rating is about. */
  async toReviewable(entries: BookingReviewEntry[], enabled: boolean, locale?: string): Promise<ReviewableCaregiver[]> {
    const profiles = await this.publicSearch.profilesFor(entries.map((e) => e.caregiverId), locale);
    return entries.map((e) => reviewableView(e, profiles.get(e.caregiverId) ?? null, enabled));
  }

  /** Caregivers the client can rate now and hasn't - the "Rate your caregiver" banner. */
  async pending(user: AuthenticatedUser, locale?: string): Promise<ReviewableCaregiver[]> {
    const patientId = this.patientIdOf(user);
    const s = await this.settings.getResolved();
    if (!s.enabled) return [];
    const bookingIds = await this.store.clientBookingIds(patientId);
    const byBooking = await this.store.entriesForClient(patientId, bookingIds, new Date(), s.windowDays);
    const open = [...byBooking.values()].flat().filter((e) => e.open && !e.review);
    open.sort((a, b) => b.lastWorkedAt.getTime() - a.lastWorkedAt.getTime());
    return this.toReviewable(open.slice(0, 20), true, locale);
  }

  /** One booking's caregiver, for the rate page. */
  async one(user: AuthenticatedUser, bookingId: string, caregiverPublicId: string, locale?: string): Promise<ReviewableCaregiver> {
    const { entry, enabled } = await this.entry(user, bookingId, caregiverPublicId);
    const [view] = await this.toReviewable([entry], enabled, locale);
    return view;
  }

  private async entry(user: AuthenticatedUser, bookingId: string, caregiverPublicId: string) {
    const patientId = this.patientIdOf(user);
    const [b] = await this.db.select({ patientId: bookings.patientId, status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    // Someone else's booking, or a draft they cannot see, reads as not found.
    if (!b || b.patientId !== patientId || b.status === 'DRAFT') throw new NotFoundException('Booking not found');
    const s = await this.settings.getResolved();
    const byBooking = await this.store.entriesForClient(patientId, [bookingId], new Date(), s.windowDays);
    const entry = byBooking.get(bookingId)?.find((e) => e.caregiverPublicId === caregiverPublicId);
    if (!entry) throw new NotFoundException('You can rate a caregiver once they have worked a shift for you');
    return { entry, patientId, enabled: s.enabled };
  }

  /** Create or replace the client's review of one caregiver on one booking. */
  async submit(user: AuthenticatedUser, bookingId: string, caregiverPublicId: string, dto: SubmitReviewDto, locale?: string): Promise<ReviewableCaregiver> {
    const { entry, patientId, enabled } = await this.entry(user, bookingId, caregiverPublicId);
    if (!enabled) throw new ConflictException('Ratings are switched off at the moment');
    if (!entry.open) throw new ConflictException('The time to rate this caregiver has passed');

    const badges = [...new Set(dto.badges ?? [])];
    const tags = [...new Set(dto.improvementTags ?? [])];
    if (dto.rating < PRAISE_MIN_RATING && badges.length) throw new BadRequestException('Badges are for 4 or 5 stars');
    if (dto.rating >= PRAISE_MIN_RATING && tags.length) throw new BadRequestException('Tell us what could be better only with 1 to 3 stars');
    const comment = dto.comment?.trim() || null;
    const privateNote = dto.privateNote?.trim() || null;
    if (comment && comment.length < MIN_REVIEW_COMMENT) throw new BadRequestException('Please write a little more in your review, or leave it empty');
    if (findContactDetails(comment)) throw new BadRequestException('Please leave phone numbers, email addresses and links out of your review - contact goes through our office');

    const now = new Date();
    let reviewId = '';
    let previous: ReviewRow | null = null;
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      // One change at a time per booking, so a double click can't make two reviews.
      await t.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`);
      const [existing] = await t
        .select()
        .from(caregiverReviews)
        .where(and(eq(caregiverReviews.bookingId, bookingId), eq(caregiverReviews.caregiverId, entry.caregiverId)))
        .limit(1);
      previous = existing ?? null;
      if (existing?.hiddenAt) throw new ConflictException('Our team has hidden this review, so it cannot be changed. You can delete it.');

      // Unchanged text keeps its state (an approved review stays approved); new text waits for staff.
      const textChanged = (existing?.comment ?? null) !== comment;
      const commentFields = !comment
        ? { comment: null, commentLanguage: null, commentStatus: 'NONE' as const, commentRejectReason: null, commentReviewedByUserId: null, commentReviewedAt: null }
        : textChanged
          ? { comment, commentLanguage: detectReviewLanguage(comment), commentStatus: 'PENDING' as const, commentRejectReason: null, commentReviewedByUserId: null, commentReviewedAt: null }
          : {};
      const fields = { rating: dto.rating, improvementTags: formatTags(tags), privateNote, ...commentFields, updatedAt: now };

      if (existing) {
        reviewId = existing.id;
        await t.update(caregiverReviews).set(fields).where(eq(caregiverReviews.id, existing.id));
        await t.delete(caregiverReviewBadges).where(eq(caregiverReviewBadges.reviewId, existing.id));
      } else {
        reviewId = uuid();
        await t.insert(caregiverReviews).values({
          id: reviewId,
          bookingId,
          caregiverId: entry.caregiverId,
          patientId,
          reviewerUserId: user.userId,
          ...fields,
          createdAt: now,
        });
      }
      if (badges.length) await t.insert(caregiverReviewBadges).values(badges.map((badge) => ({ reviewId, badge })));
      await this.store.recompute(t, entry.caregiverId);
      const [cg] = await t.select({ fullName: caregivers.fullName }).from(caregivers).where(eq(caregivers.id, entry.caregiverId)).limit(1);
      await t.insert(bookingEvents).values({
        id: uuid(),
        bookingId,
        type: 'REVIEWED',
        note: `Client ${existing ? 'changed their rating of' : 'rated'} ${cg?.fullName ?? 'the caregiver'}: ${STARS(dto.rating)}`,
        actorUserId: user.userId,
      });
    });

    const before = previous as ReviewRow | null;
    // Newly low (not every edit of a review already low) - the office follows up.
    if (dto.rating <= LOW_RATING_MAX && (!before || before.rating > LOW_RATING_MAX)) void this.notifier.lowRating(reviewId);
    // Praise once, when the review is first given.
    if (!before && dto.rating >= PRAISE_MIN_RATING && badges.length) void this.notifier.praise(entry.caregiverId, dto.rating, badges);
    return this.one(user, bookingId, caregiverPublicId, locale);
  }

  async remove(user: AuthenticatedUser, bookingId: string, caregiverPublicId: string): Promise<void> {
    const { entry } = await this.entry(user, bookingId, caregiverPublicId);
    if (!entry.review) throw new NotFoundException('Review not found');
    const id = entry.review.id;
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await t.delete(caregiverReviewBadges).where(eq(caregiverReviewBadges.reviewId, id));
      await t.delete(caregiverReviews).where(eq(caregiverReviews.id, id));
      await this.store.recompute(t, entry.caregiverId);
      await t.insert(bookingEvents).values({ id: uuid(), bookingId, type: 'REVIEWED', note: 'Client deleted their rating', actorUserId: user.userId });
    });
  }

  // --- public ------------------------------------------------------------------------

  async publicPage(caregiverPublicId: string, page = 1, localeParam?: string): Promise<PublicReviewsPage> {
    const locale = resolveLocale(localeParam);
    const [cg] = await this.db
      .select({ id: caregivers.id, status: caregivers.status, deletedAt: caregivers.deletedAt })
      .from(caregivers)
      .where(eq(caregivers.publicId, caregiverPublicId))
      .limit(1);
    // Same answer whether the profile is missing or not public - never confirm which.
    if (!cg || cg.deletedAt || !(PUBLIC_CAREGIVER_STATUSES as readonly string[]).includes(cg.status)) throw new NotFoundException('Caregiver not found');
    const s = await this.settings.getResolved();
    const stats = (await this.store.statsFor([cg.id])).get(cg.id);
    const summary = publicSummary(stats, s);
    const empty: PublicReviewsPage = { summary: null, badgeCounts: [], items: [], total: 0, page, pageSize: PUBLIC_REVIEWS_PAGE_SIZE };
    // Below the threshold nothing is shown - not even the text, which would give the single rating away.
    if (!summary || !stats) return empty;

    const where = and(eq(caregiverReviews.caregiverId, cg.id), isNull(caregiverReviews.hiddenAt), eq(caregiverReviews.commentStatus, 'APPROVED'));
    const [{ total }] = await this.db.select({ total: count() }).from(caregiverReviews).where(where);
    const rows = await this.db
      .select({ r: caregiverReviews, d: districts })
      .from(caregiverReviews)
      .innerJoin(patients, eq(caregiverReviews.patientId, patients.id))
      .leftJoin(districts, eq(patients.districtId, districts.id))
      .where(where)
      .orderBy(desc(caregiverReviews.createdAt))
      .limit(PUBLIC_REVIEWS_PAGE_SIZE)
      .offset((page - 1) * PUBLIC_REVIEWS_PAGE_SIZE);
    const badges = await this.store.badgesFor(rows.map((x) => x.r.id));
    return {
      summary,
      badgeCounts: stats.badgeCounts,
      items: rows.map(({ r, d }) => this.publicReview(r, badges.get(r.id) ?? [], d, locale)),
      total: Number(total),
      page,
      pageSize: PUBLIC_REVIEWS_PAGE_SIZE,
    };
  }

  private publicReview(r: ReviewRow, badges: PublicReview['badges'], d: typeof districts.$inferSelect | null, locale: Locale): PublicReview {
    const approved = r.commentStatus === 'APPROVED';
    return {
      id: r.id,
      rating: r.rating,
      badges,
      comment: approved ? r.comment : null,
      commentLanguage: approved ? r.commentLanguage : null,
      reviewerDistrict: d ? (locale === 'si' ? d.nameSi : locale === 'ta' ? d.nameTa : d.nameEn) : null,
      month: new Date(r.createdAt).toISOString().slice(0, 7),
    };
  }

  // --- caregivers --------------------------------------------------------------------

  async own(user: AuthenticatedUser, localeParam?: string): Promise<CaregiverOwnRatings> {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('You do not have permission to perform this action');
    const locale = resolveLocale(localeParam);
    const s = await this.settings.getResolved();
    const stats = (await this.store.statsFor([user.caregiverId])).get(user.caregiverId);
    const rows = await this.db
      .select({ r: caregiverReviews, d: districts })
      .from(caregiverReviews)
      .innerJoin(patients, eq(caregiverReviews.patientId, patients.id))
      .leftJoin(districts, eq(patients.districtId, districts.id))
      .where(and(eq(caregiverReviews.caregiverId, user.caregiverId), isNull(caregiverReviews.hiddenAt), eq(caregiverReviews.commentStatus, 'APPROVED')))
      .orderBy(desc(caregiverReviews.createdAt))
      .limit(50);
    const badges = await this.store.badgesFor(rows.map((x) => x.r.id));
    return {
      summary: stats ? { average: roundRating(stats.ratingSum, stats.ratingCount), count: stats.ratingCount } : null,
      shownPublicly: shownPublicly(stats?.ratingCount ?? 0, s),
      minRatingsToShow: s.minRatingsToShow,
      badgeCounts: stats?.badgeCounts ?? [],
      reviews: rows.map(({ r, d }) => this.publicReview(r, badges.get(r.id) ?? [], d, locale)),
    };
  }

  // --- staff -------------------------------------------------------------------------

  private filterWhere(filter: StaffReviewQueryDto['filter']): SQL | undefined {
    switch (filter) {
      case 'pending':
        return and(eq(caregiverReviews.commentStatus, 'PENDING'), isNull(caregiverReviews.hiddenAt));
      case 'low':
        return and(lte(caregiverReviews.rating, LOW_RATING_MAX), isNull(caregiverReviews.hiddenAt));
      case 'hidden':
        return isNotNull(caregiverReviews.hiddenAt);
      default:
        return undefined;
    }
  }

  async list(q: StaffReviewQueryDto): Promise<StaffReviewList> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const conditions: (SQL | undefined)[] = [this.filterWhere(q.filter ?? 'pending')];
    if (q.caregiverId) conditions.push(eq(caregiverReviews.caregiverId, q.caregiverId));
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conditions.push(or(like(caregivers.fullName, term), like(patients.fullName, term), like(bookings.reference, term)));
    }
    const where = and(...conditions);
    const base = () =>
      this.db
        .select({ total: count() })
        .from(caregiverReviews)
        .innerJoin(bookings, eq(caregiverReviews.bookingId, bookings.id))
        .innerJoin(caregivers, eq(caregiverReviews.caregiverId, caregivers.id))
        .innerJoin(patients, eq(caregiverReviews.patientId, patients.id));
    const [[{ total }], rows, counts] = await Promise.all([
      base().where(where),
      this.staffRows(where, pageSize, (page - 1) * pageSize),
      this.counts(),
    ]);
    return { items: await this.toStaff(rows), total: Number(total), page, pageSize, counts };
  }

  async counts(): Promise<StaffReviewList['counts']> {
    const n = async (w: SQL | undefined) => Number((await this.db.select({ n: count() }).from(caregiverReviews).where(w))[0]?.n ?? 0);
    const [pending, low, hidden] = await Promise.all([n(this.filterWhere('pending')), n(this.filterWhere('low')), n(this.filterWhere('hidden'))]);
    return { pending, low, hidden };
  }

  async forCaregiver(caregiverId: string): Promise<StaffCaregiverRatings> {
    const [cg] = await this.db.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
    if (!cg) throw new NotFoundException('Caregiver not found');
    const s = await this.settings.getResolved();
    const stats = (await this.store.statsFor([caregiverId])).get(caregiverId);
    const reviews = await this.toStaff(await this.staffRows(eq(caregiverReviews.caregiverId, caregiverId), 200, 0));
    const tagCounts = new Map<string, number>();
    for (const r of reviews) if (!r.hiddenAt) for (const t of r.improvementTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    return {
      summary: stats ? { average: roundRating(stats.ratingSum, stats.ratingCount), count: stats.ratingCount } : null,
      shownPublicly: shownPublicly(stats?.ratingCount ?? 0, s),
      badgeCounts: stats?.badgeCounts ?? [],
      improvementCounts: [...tagCounts].map(([tag, n]) => ({ tag: tag as StaffCaregiverRatings['improvementCounts'][number]['tag'], count: n })).sort((a, b) => b.count - a.count),
      reviews,
    };
  }

  async forBooking(bookingId: string): Promise<StaffReview[]> {
    return this.toStaff(await this.staffRows(eq(caregiverReviews.bookingId, bookingId), 50, 0));
  }

  async approveComment(id: string, actor: AuthenticatedUser): Promise<StaffReview> {
    await this.db.transaction(async (tx) => {
      const r = await this.lock(tx as unknown as Tx, id);
      if (r.commentStatus !== 'PENDING') throw new ConflictException('This review is not waiting for approval');
      await tx
        .update(caregiverReviews)
        .set({ commentStatus: 'APPROVED', commentRejectReason: null, commentReviewedByUserId: actor.userId, commentReviewedAt: new Date() })
        .where(eq(caregiverReviews.id, id));
    });
    return this.staffOne(id);
  }

  async rejectComment(id: string, dto: ReviewReasonDto, actor: AuthenticatedUser): Promise<StaffReview> {
    await this.db.transaction(async (tx) => {
      const r = await this.lock(tx as unknown as Tx, id);
      if (r.commentStatus !== 'PENDING' && r.commentStatus !== 'APPROVED') throw new ConflictException('This review has no written part to reject');
      await tx
        .update(caregiverReviews)
        .set({ commentStatus: 'REJECTED', commentRejectReason: dto.reason.trim(), commentReviewedByUserId: actor.userId, commentReviewedAt: new Date() })
        .where(eq(caregiverReviews.id, id));
    });
    void this.notifier.commentRejected(id);
    return this.staffOne(id);
  }

  async hide(id: string, dto: ReviewReasonDto, actor: AuthenticatedUser): Promise<StaffReview> {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const r = await this.lock(t, id);
      if (r.hiddenAt) throw new ConflictException('This review is already hidden');
      await t.update(caregiverReviews).set({ hiddenAt: new Date(), hiddenByUserId: actor.userId, hiddenReason: dto.reason.trim() }).where(eq(caregiverReviews.id, id));
      await this.store.recompute(t, r.caregiverId);
    });
    return this.staffOne(id);
  }

  async unhide(id: string): Promise<StaffReview> {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const r = await this.lock(t, id);
      if (!r.hiddenAt) throw new ConflictException('This review is not hidden');
      await t.update(caregiverReviews).set({ hiddenAt: null, hiddenByUserId: null, hiddenReason: null }).where(eq(caregiverReviews.id, id));
      await this.store.recompute(t, r.caregiverId);
    });
    return this.staffOne(id);
  }

  private async lock(t: Tx, id: string): Promise<ReviewRow> {
    await t.execute(sql`SELECT id FROM caregiver_reviews WHERE id = ${id} FOR UPDATE`);
    const [r] = await t.select().from(caregiverReviews).where(eq(caregiverReviews.id, id)).limit(1);
    if (!r) throw new NotFoundException('Review not found');
    return r;
  }

  private async staffOne(id: string): Promise<StaffReview> {
    const [r] = await this.toStaff(await this.staffRows(eq(caregiverReviews.id, id), 1, 0));
    if (!r) throw new NotFoundException('Review not found');
    return r;
  }

  private staffRows(where: SQL | undefined, limit: number, offset: number) {
    return this.db
      .select({
        r: caregiverReviews,
        reference: bookings.reference,
        caregiverName: caregivers.fullName,
        caregiverPublicId: caregivers.publicId,
        clientName: patients.fullName,
      })
      .from(caregiverReviews)
      .innerJoin(bookings, eq(caregiverReviews.bookingId, bookings.id))
      .innerJoin(caregivers, eq(caregiverReviews.caregiverId, caregivers.id))
      .innerJoin(patients, eq(caregiverReviews.patientId, patients.id))
      .where(where)
      .orderBy(desc(caregiverReviews.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  private async toStaff(rows: Awaited<ReturnType<ReviewsService['staffRows']>>): Promise<StaffReview[]> {
    const badges = await this.store.badgesFor(rows.map((x) => x.r.id));
    const staffIds = [...new Set(rows.flatMap(({ r }) => [r.commentReviewedByUserId, r.hiddenByUserId]).filter((v): v is string => Boolean(v)))];
    const names = new Map(staffIds.length ? (await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, staffIds))).map((u) => [u.id, u.fullName]) : []);
    const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
    return rows.map(({ r, reference, caregiverName, caregiverPublicId, clientName }) => ({
      id: r.id,
      bookingId: r.bookingId,
      bookingReference: reference,
      caregiverId: r.caregiverId,
      caregiverName,
      caregiverPublicId,
      patientId: r.patientId,
      clientName,
      rating: r.rating,
      badges: sortBadgeCounts((badges.get(r.id) ?? []).map((badge) => ({ badge, count: 1 }))).map((b) => b.badge),
      improvementTags: parseTags(r.improvementTags),
      comment: r.comment,
      commentLanguage: r.commentLanguage,
      commentStatus: r.commentStatus,
      commentRejectReason: r.commentRejectReason,
      commentReviewedBy: r.commentReviewedByUserId ? (names.get(r.commentReviewedByUserId) ?? null) : null,
      commentReviewedAt: iso(r.commentReviewedAt),
      privateNote: r.privateNote,
      hiddenAt: iso(r.hiddenAt),
      hiddenBy: r.hiddenByUserId ? (names.get(r.hiddenByUserId) ?? null) : null,
      hiddenReason: r.hiddenReason,
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }
}
