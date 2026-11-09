'use client';

import { useTranslation } from '@/lib/i18n/provider';
import { useBookingRatings, useCaregiverRatings } from '@/lib/hooks/use-reviews';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StaffReviewCard, StarsInline } from './review-card';

/** A caregiver's ratings for staff: totals, badges, private "could be better" counts and every rating. */
export function CaregiverRatingsPanel({ caregiverId }: { caregiverId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCaregiverRatings(caregiverId);
  if (isLoading) return <p className="text-sm text-ink/60">{t('common.loading')}</p>;
  if (isError || !data) return <p role="alert" className="text-sm text-danger">{t('common.actionFailed')}</p>;
  if (!data.reviews.length) return <p className="text-sm text-ink/60">{t('reviews.panel.none')}</p>;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-5">
          {data.summary && (
            <div className="flex flex-wrap items-center gap-3">
              <StarsInline rating={data.summary.average} />
              <span className="font-semibold text-ink">{t('reviews.panel.summary', { average: data.summary.average.toFixed(1), count: data.summary.count })}</span>
              <span className="text-sm text-ink/60">{data.shownPublicly ? t('reviews.panel.shown') : t('reviews.panel.notShown')}</span>
            </div>
          )}
          {data.badgeCounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.badgeCounts.map((b) => (
                <span key={b.badge} className="rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-medium text-accent-dark">
                  {t(`reviews.badge.${b.badge}`)} × {b.count}
                </span>
              ))}
            </div>
          )}
          {data.improvementCounts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.panel.improvements')}</p>
              <p className="mt-1 text-sm text-ink/80">{data.improvementCounts.map((c) => `${t(`reviews.tag.${c.tag}`)} × ${c.count}`).join(' · ')}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <h3 className="text-sm font-semibold text-ink">{t('reviews.panel.reviews')}</h3>
      <div className="space-y-3">
        {data.reviews.map((r) => (
          <StaffReviewCard key={r.id} review={r} context="caregiver" />
        ))}
      </div>
    </div>
  );
}

/** The ratings given on one booking (one per caregiver who worked on it). */
export function BookingRatingsCard({ bookingId }: { bookingId: string }) {
  const { t } = useTranslation();
  const { data } = useBookingRatings(bookingId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reviews.bookingTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data?.length ? (
          <p className="text-sm text-ink/60">{t('reviews.bookingNone')}</p>
        ) : (
          data.map((r) => <StaffReviewCard key={r.id} review={r} context="booking" />)
        )}
      </CardContent>
    </Card>
  );
}
