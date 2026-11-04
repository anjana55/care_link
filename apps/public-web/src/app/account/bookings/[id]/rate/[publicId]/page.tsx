'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { fmtDate } from '@/lib/colombo-time';
import { useBookingReview, useDeleteReview, useSubmitReview } from '@/lib/hooks/use-reviews';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CaregiverSummary } from '@/components/care/caregiver-summary';
import { ReviewForm } from '@/components/reviews/review-form';
import { Stars, BadgeChip } from '@/components/reviews/stars';
import { Button } from '@/components/ui/button';

/**
 * Rating one caregiver for one booking - the booked caregiver or a cover.
 * Reached from Bookings, from the rating request message, and (through app
 * links) from the app's notification.
 */
export default function RateCaregiverPage() {
  const { t, locale } = useTranslation();
  const params = useParams<{ id: string; publicId: string }>();
  const { data, isLoading, isError, error, refetch } = useBookingReview(params.id, params.publicId);
  const submit = useSubmitReview(params.id, params.publicId);
  const remove = useDeleteReview(params.id, params.publicId);
  const [done, setDone] = useState<'saved' | 'deleted' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);

  const back = (
    <Link href="/account/bookings" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t('reviews.form.back')}
    </Link>
  );

  if (isLoading) return <LoadingState label={t('common.loading')} />;
  if (isError) {
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="space-y-4">
          {back}
          <p className="rounded-lg border border-border bg-white p-6 text-sm text-ink/70">{t('reviews.form.notFound')}</p>
        </div>
      );
    }
    return <ErrorState onRetry={() => refetch()} />;
  }
  if (!data) return null;

  const review = data.review;
  const errorText = submit.error instanceof Error ? submit.error.message : remove.error instanceof Error ? remove.error.message : null;
  const showForm = data.canReview && !review?.hidden && (!review || editing || done === 'deleted');
  const formReview = done === 'deleted' ? null : review;

  return (
    <div className="space-y-5">
      {back}
      <div className="rounded-lg border border-border bg-white p-5 sm:p-6">
        <h1 className="text-xl font-semibold text-ink">{t('reviews.form.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('reviews.form.intro')}</p>
        <div className="mt-4 rounded-DEFAULT bg-paper p-3">
          <CaregiverSummary publicId={data.caregiverPublicId} caregiver={data.caregiver} unavailableText={t('account.requests.notOnline')} />
          <p className="mt-2 text-xs text-ink/50">
            {t('reviews.form.bookingLabel', { reference: data.bookingReference })}
            {data.isCover && ` · ${t('reviews.cover')}`}
          </p>
        </div>

        {done && (
          <p role="status" className="mt-4 rounded-DEFAULT bg-brand-light px-3 py-2 text-sm font-medium text-brand-dark">
            {done === 'saved' ? t('reviews.form.thanks') : t('reviews.form.deleted')}
          </p>
        )}
        {!data.canReview && !review && <p className="mt-4 text-sm text-ink/70">{t('reviews.form.closedNote')}</p>}
        {review?.hidden && <p className="mt-4 text-sm text-ink/70">{t('reviews.form.hiddenNote')}</p>}

        {review && !editing && done !== 'deleted' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm font-semibold text-ink">{t('reviews.yourRating')}</p>
            <Stars rating={review.rating} size="md" />
            {review.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {review.badges.map((b) => (
                  <BadgeChip key={b} badge={b} />
                ))}
              </div>
            )}
            {review.comment && <p className="whitespace-pre-line text-sm text-ink/80">{review.comment}</p>}
            {review.comment && review.commentStatus !== 'NONE' && (
              <p className="text-xs text-ink/60">{t(`reviews.commentStatus.${review.commentStatus}`, { reason: review.commentRejectReason ?? '' })}</p>
            )}
            {data.canReview && !review.hidden && <p className="text-xs text-ink/50">{t('reviews.until', { date: fmtDate(data.reviewUntil.slice(0, 10), locale) })}</p>}
            <div className="flex flex-wrap gap-3 pt-1">
              {data.canReview && !review.hidden && (
                <Button type="button" variant="secondary" size="lg" onClick={() => { setEditing(true); setDone(null); }}>
                  {t('reviews.edit')}
                </Button>
              )}
              {!confirming ? (
                <Button type="button" variant="ghost" size="lg" onClick={() => setConfirming(true)}>
                  {t('reviews.form.delete')}
                </Button>
              ) : (
                <div role="alertdialog" aria-label={t('reviews.form.deleteConfirm')} className="w-full rounded-DEFAULT border border-border p-3">
                  <p className="text-sm text-ink">{t('reviews.form.deleteConfirm')}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(undefined, { onSuccess: () => { setConfirming(false); setDone('deleted'); } })}
                    >
                      {t('reviews.form.deleteYes')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                      {t('reviews.form.keep')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showForm && (
          <div className="mt-5">
            <ReviewForm
              key={formReview?.updatedAt ?? 'new'}
              existing={formReview}
              pending={submit.isPending}
              error={errorText}
              reportHref={`/account/bookings#booking-${data.bookingId}`}
              onSubmit={(body) =>
                submit.mutate(body, {
                  onSuccess: () => {
                    setEditing(false);
                    setDone('saved');
                  },
                })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
