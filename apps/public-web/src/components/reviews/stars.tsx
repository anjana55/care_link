'use client';

import { useId } from 'react';
import { Star } from 'lucide-react';
import type { CaregiverRatingSummary, ReviewBadge } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';

/** Read-only stars. Half stars are rounded to the nearest whole for the picture; the text says the exact value. */
export function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const { t } = useTranslation();
  const filled = Math.round(rating);
  const cls = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  return (
    <span className="inline-flex items-center" role="img" aria-label={t('reviews.outOfFive', { rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden className={`${cls} ${i <= filled ? 'fill-amber-400 text-amber-500' : 'fill-transparent text-ink/25'}`} />
      ))}
    </span>
  );
}

/**
 * Choosing 1-5 stars: a radio group, so it works with the keyboard and a
 * screen reader. Each star is a large target (48px) for older users and
 * shaky fingers; the word under it ("Good") says what the number means.
 */
export function StarPicker({ value, onChange, invalid }: { value: number; onChange: (v: number) => void; invalid?: boolean }) {
  const { t } = useTranslation();
  const name = useId();
  return (
    <div>
      <div role="radiogroup" aria-label={t('reviews.form.starsQuestion')} aria-invalid={invalid || undefined} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <label key={i} className="cursor-pointer rounded-DEFAULT p-1 focus-within:ring-2 focus-within:ring-brand">
            <input
              type="radio"
              name={name}
              value={i}
              checked={value === i}
              onChange={() => onChange(i)}
              className="sr-only"
              aria-label={i === 1 ? t('reviews.starOne') : t('reviews.starMany', { count: i })}
            />
            <Star aria-hidden className={`h-10 w-10 transition-colors ${i <= value ? 'fill-amber-400 text-amber-500' : 'fill-transparent text-ink/30 hover:text-amber-400'}`} />
          </label>
        ))}
      </div>
      <p className="mt-1 h-5 text-sm font-medium text-ink/70" aria-live="polite">
        {value ? t(`reviews.form.starHint.${value}`) : ''}
      </p>
    </div>
  );
}

/** "★ 4.8 · 12 ratings", for search cards and account lists. Renders nothing when there is no rating to show. */
export function RatingLine({ rating, showTopBadge = false }: { rating: CaregiverRatingSummary | null | undefined; showTopBadge?: boolean }) {
  const { t } = useTranslation();
  if (!rating) return null;
  const top = rating.topBadges[0];
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1 font-semibold text-ink">
        <Star aria-hidden className="h-4 w-4 fill-amber-400 text-amber-500" />
        <span className="sr-only">{t('reviews.outOfFive', { rating: rating.average })}</span>
        <span aria-hidden>{rating.average.toFixed(1)}</span>
      </span>
      <span className="text-ink/60">· {rating.count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count: rating.count })}</span>
      {showTopBadge && top && <BadgeChip badge={top.badge} count={top.count} />}
    </p>
  );
}

export function BadgeChip({ badge, count }: { badge: ReviewBadge; count?: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-medium text-accent-dark">
      {t(`reviews.badge.${badge}`)}
      {count !== undefined && count > 1 && <span className="tabular-nums text-accent-dark/70">× {count}</span>}
    </span>
  );
}
