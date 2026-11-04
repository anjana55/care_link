'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import type { ReviewableCaregiver } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { usePendingReviews } from '@/lib/hooks/use-reviews';
import { Stars } from './stars';

export const rateHref = (r: Pick<ReviewableCaregiver, 'bookingId' | 'caregiverPublicId'>) => `/account/bookings/${r.bookingId}/rate/${r.caregiverPublicId}`;

/** On one booking: each caregiver who has worked on it, with the client's rating or a Rate button. */
export function BookingReviews({ reviews }: { reviews: ReviewableCaregiver[] }) {
  const { t } = useTranslation();
  if (!reviews.length) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.yourRating')}</p>
      <ul className="space-y-2">
        {reviews.map((r) => (
          <li key={r.caregiverPublicId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink/80">
              {t('profile.anonymousId', { id: r.caregiverPublicId.slice(0, 8) })}
              {r.isCover && <span className="text-ink/50"> · {t('reviews.cover')}</span>}
            </span>
            {r.review ? (
              <Link href={rateHref(r)} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand hover:underline">
                <Stars rating={r.review.rating} />
                {r.canReview ? t('reviews.edit') : ''}
              </Link>
            ) : r.canReview ? (
              <Link
                href={rateHref(r)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-DEFAULT bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
              >
                <Star className="h-4 w-4" aria-hidden />
                {t('reviews.rateCaregiver')}
              </Link>
            ) : (
              <span className="text-xs text-ink/50">{t('reviews.closed')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "How was your care?" above the bookings, while there are caregivers to rate. */
export function PendingReviewsBanner() {
  const { t } = useTranslation();
  const { data } = usePendingReviews();
  if (!data?.length) return null;
  const first = data[0];
  return (
    <section aria-labelledby="pending-reviews" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 id="pending-reviews" className="flex items-center gap-2 text-base font-semibold text-ink">
        <Star className="h-5 w-5 fill-amber-400 text-amber-500" aria-hidden />
        {t('reviews.bannerTitle')}
      </h2>
      <p className="mt-1 text-sm text-ink/70">{data.length === 1 ? t('reviews.bannerOne') : t('reviews.bannerMany', { count: data.length })}</p>
      <Link
        href={rateHref(first)}
        className="mt-3 inline-flex min-h-11 items-center rounded-DEFAULT bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
      >
        {t('reviews.rateNow')}
      </Link>
    </section>
  );
}
