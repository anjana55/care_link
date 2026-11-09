'use client';

import type { BadgeCount, PublicReview } from '@care-platform/shared';
import { useTranslation, type Locale } from '@/lib/i18n';
import { usePublicReviews } from '@/lib/hooks/use-reviews';
import { Button } from '@/components/ui/button';
import { BadgeChip, Stars } from './stars';

const INTL: Record<Locale, string> = { en: 'en-LK', si: 'si-LK', ta: 'ta-LK' };

/** "March 2026", in the reader's language. */
export function reviewMonth(month: string, locale: Locale) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(INTL[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function BadgeCounts({ counts, title }: { counts: BadgeCount[]; title: string }) {
  if (!counts.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {counts.map((b) => (
          <li key={b.badge}>
            <BadgeChip badge={b.badge} count={b.count} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One review as anyone sees it: stars, badges, text, "Client · Kandy district", month. Never a name. */
export function ReviewItem({ review }: { review: PublicReview }) {
  const { t, locale } = useTranslation();
  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stars rating={review.rating} />
        <span className="text-xs text-ink/50">{reviewMonth(review.month, locale)}</span>
      </div>
      {review.badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {review.badges.map((b) => (
            <BadgeChip key={b} badge={b} />
          ))}
        </div>
      )}
      {review.comment && (
        <p lang={review.commentLanguage ?? undefined} className="mt-2 whitespace-pre-line text-sm text-ink/80">
          {review.comment}
        </p>
      )}
      <p className="mt-1.5 text-xs text-ink/50">
        {review.reviewerDistrict ? t('reviews.profile.reviewer', { district: review.reviewerDistrict }) : t('reviews.profile.reviewerNoDistrict')}
      </p>
    </li>
  );
}

/**
 * Ratings on a public profile. Shows nothing until the caregiver has enough
 * ratings to show (Settings > Reviews) - the API answers with no summary.
 */
export function CaregiverReviews({ publicId }: { publicId: string }) {
  const { t } = useTranslation();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = usePublicReviews(publicId);
  const first = data?.pages[0];
  if (!first?.summary) return null;
  const items = data!.pages.flatMap((p) => p.items);
  const s = first.summary;

  return (
    <section aria-labelledby="reviews-title" className="mt-6 rounded-lg border border-border bg-white p-6 sm:p-8">
      <h2 id="reviews-title" className="text-lg font-semibold text-ink">
        {t('reviews.profile.title')}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-4xl font-bold tabular-nums text-ink" aria-hidden>
          {s.average.toFixed(1)}
        </span>
        <div>
          <Stars rating={s.average} size="md" />
          <p className="text-sm text-ink/60">
            {s.count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count: s.count })} · {t('reviews.profile.basedOn')}
          </p>
        </div>
      </div>
      <div className="mt-5">
        <BadgeCounts counts={first.badgeCounts} title={t('reviews.profile.badges')} />
      </div>
      <div className="mt-6">
        {items.length === 0 ? (
          <p className="text-sm text-ink/60">{t('reviews.profile.noWritten')}</p>
        ) : (
          <ul>
            {items.map((r) => (
              <ReviewItem key={r.id} review={r} />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <Button type="button" variant="secondary" size="lg" className="mt-4" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {t('reviews.profile.more')}
          </Button>
        )}
      </div>
    </section>
  );
}
