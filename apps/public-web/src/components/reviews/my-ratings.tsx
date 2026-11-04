'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { useMyRatings } from '@/lib/hooks/use-reviews';
import { BadgeCounts, ReviewItem } from './caregiver-reviews';
import { Stars } from './stars';

/** A caregiver's own ratings: their average (even before it is shown publicly), badges and approved reviews. */
export function MyRatings() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMyRatings();
  if (isLoading) return <p className="text-sm text-ink/50">{t('common.loading')}</p>;
  if (isError || !data) return <p className="text-sm text-danger">{t('portal.loadError')}</p>;
  if (!data.summary) return <p className="text-sm text-ink/60">{t('reviews.caregiver.none')}</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-4xl font-bold tabular-nums text-ink" aria-hidden>
          {data.summary.average.toFixed(1)}
        </span>
        <div>
          <Stars rating={data.summary.average} size="md" />
          <p className="text-sm text-ink/60">
            {data.summary.count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count: data.summary.count })}
          </p>
        </div>
      </div>
      <p className="text-sm text-ink/70">
        {data.shownPublicly ? t('reviews.caregiver.shown') : t('reviews.caregiver.notShownYet', { min: data.minRatingsToShow })}
      </p>
      <BadgeCounts counts={data.badgeCounts} title={t('reviews.caregiver.badges')} />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.caregiver.reviews')}</p>
        {data.reviews.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">{t('reviews.caregiver.noReviews')}</p>
        ) : (
          <ul className="mt-3">
            {data.reviews.map((r) => (
              <ReviewItem key={r.id} review={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The dashboard tile: average and count, linking to the ratings page. */
export function MyRatingsTile() {
  const { t } = useTranslation();
  const { data } = useMyRatings();
  if (!data?.summary) return null;
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink">{t('reviews.caregiver.title')}</h2>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-lg font-bold tabular-nums text-ink">{data.summary.average.toFixed(1)}</span>
          <Stars rating={data.summary.average} />
          <span className="text-sm text-ink/60">
            · {data.summary.count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count: data.summary.count })}
          </span>
        </div>
      </div>
      <Link href="/caregiver/ratings" className="whitespace-nowrap text-sm font-medium text-brand-dark hover:underline">
        {t('reviews.caregiver.view')}
      </Link>
    </section>
  );
}
