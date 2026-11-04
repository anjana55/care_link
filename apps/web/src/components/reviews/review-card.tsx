'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';
import { LOW_RATING_MAX, MAX_REVIEW_REASON, type StaffReview } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { fmtDateTime } from '@/lib/colombo-time';
import { useReviewAction } from '@/lib/hooks/use-reviews';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label, Textarea } from '@/components/ui/input';

export function StarsInline({ rating }: { rating: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center" role="img" aria-label={t('reviews.outOfFive', { rating })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} aria-hidden size={16} className={i <= Math.round(rating) ? 'fill-amber-400 text-amber-500' : 'text-ink/25'} />
      ))}
    </span>
  );
}

const STATUS_TONE: Record<StaffReview['commentStatus'], string> = {
  NONE: 'bg-paper text-ink/60',
  PENDING: 'bg-accent-light text-accent-dark',
  APPROVED: 'bg-brand-light text-brand-dark',
  REJECTED: 'bg-paper text-ink/60',
};

/**
 * One rating, everything included - private feedback too - with the staff
 * actions: approve or reject the written part, hide or show the whole rating.
 * `context` drops the links that would point back at the page it sits on.
 */
export function StaffReviewCard({ review: r, context = 'queue' }: { review: StaffReview; context?: 'queue' | 'caregiver' | 'booking' }) {
  const { t, locale } = useTranslation();
  const act = useReviewAction();
  const [asking, setAsking] = useState<'reject-comment' | 'hide' | null>(null);
  const [reason, setReason] = useState('');
  const low = r.rating <= LOW_RATING_MAX;
  const errorText = act.error ? (act.error instanceof ApiError && act.error.message ? act.error.message : t('common.actionFailed')) : null;

  return (
    <article className={`rounded-lg border bg-white p-4 ${r.hiddenAt ? 'border-dashed border-border opacity-75' : low ? 'border-danger/40' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <StarsInline rating={r.rating} />
            {low && !r.hiddenAt && <span className="rounded-full bg-danger-light px-2 py-0.5 text-xs font-medium text-danger">{t('reviews.low')}</span>}
          </div>
          <p className="text-sm text-ink/80">
            {context !== 'caregiver' && (
              <>
                {t('reviews.caregiver')}:{' '}
                <Link href={`/caregivers/${r.caregiverId}`} className="font-medium text-brand-dark hover:underline">
                  {r.caregiverName}
                </Link>
                {' · '}
              </>
            )}
            {t('reviews.client')}:{' '}
            <Link href={`/clients/${r.patientId}`} className="font-medium text-brand-dark hover:underline">
              {r.clientName}
            </Link>
            {context !== 'booking' && (
              <>
                {' · '}
                {t('reviews.booking')}{' '}
                <Link href={`/bookings/${r.bookingId}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                  {r.bookingReference}
                </Link>
              </>
            )}
          </p>
          <p className="text-xs text-ink/50">{t('reviews.given', { date: fmtDateTime(r.updatedAt, locale) })}</p>
        </div>
        {r.comment && (
          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[r.commentStatus]}`}>{t(`reviews.status.${r.commentStatus}`)}</span>
        )}
      </div>

      {r.badges.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.badges')}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.badges.map((b) => (
              <span key={b} className="rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-medium text-accent-dark">
                {t(`reviews.badge.${b}`)}
              </span>
            ))}
          </div>
        </div>
      )}
      {r.improvementTags.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.couldBeBetter')}</p>
          <p className="mt-1 text-sm text-ink/80">{r.improvementTags.map((x) => t(`reviews.tag.${x}`)).join(', ')}</p>
        </div>
      )}
      {r.comment && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
            {t('reviews.writtenReview')}
            {r.commentLanguage ? ` · ${t(`reviews.language.${r.commentLanguage}`)}` : ''}
          </p>
          <p lang={r.commentLanguage ?? undefined} className="mt-1 whitespace-pre-line rounded-DEFAULT bg-paper p-3 text-sm text-ink">
            {r.comment}
          </p>
          {r.commentReviewedBy && r.commentReviewedAt && r.commentStatus !== 'PENDING' && (
            <p className="mt-1 text-xs text-ink/50">
              {t('reviews.reviewedBy', { status: t(`reviews.status.${r.commentStatus}`), name: r.commentReviewedBy, date: fmtDateTime(r.commentReviewedAt, locale) })}
            </p>
          )}
          {r.commentStatus === 'REJECTED' && r.commentRejectReason && <p className="mt-1 text-xs text-ink/60">{t('reviews.rejectReason', { reason: r.commentRejectReason })}</p>}
        </div>
      )}
      {r.privateNote && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('reviews.privateNote')}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink/80">{r.privateNote}</p>
        </div>
      )}
      {r.hiddenAt && (
        <p className="mt-3 text-sm text-ink/70">
          {t('reviews.hiddenNote')} {t('reviews.hiddenBy', { name: r.hiddenBy ?? '—', date: fmtDateTime(r.hiddenAt, locale), reason: r.hiddenReason ?? '' })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!r.hiddenAt && r.commentStatus === 'PENDING' && (
          <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'approve-comment' })}>
            {t('reviews.approve')}
          </Button>
        )}
        {!r.hiddenAt && (r.commentStatus === 'PENDING' || r.commentStatus === 'APPROVED') && (
          <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => setAsking('reject-comment')}>
            {t('reviews.reject')}
          </Button>
        )}
        {r.hiddenAt ? (
          <Button size="sm" variant="secondary" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'unhide' })}>
            {t('reviews.unhide')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => setAsking('hide')}>
            {t('reviews.hide')}
          </Button>
        )}
      </div>
      {errorText && !asking && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorText}
        </p>
      )}

      {asking && (
        <ConfirmDialog
          title={asking === 'hide' ? t('reviews.hideTitle') : t('reviews.rejectTitle')}
          message={asking === 'hide' ? t('reviews.hideHint') : t('reviews.rejectHint')}
          confirmLabel={asking === 'hide' ? t('reviews.hide') : t('reviews.reject')}
          tone="danger"
          pending={act.isPending}
          error={errorText}
          onConfirm={() => {
            if (reason.trim().length < 3) return;
            act.mutate(
              { id: r.id, action: asking, reason: reason.trim() },
              {
                onSuccess: () => {
                  setAsking(null);
                  setReason('');
                },
              },
            );
          }}
          onCancel={() => {
            act.reset();
            setAsking(null);
            setReason('');
          }}
        >
          <div className="mt-3">
            <Label htmlFor={`reason-${r.id}`}>{t('reviews.reason')}</Label>
            <Textarea id={`reason-${r.id}`} rows={3} maxLength={MAX_REVIEW_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
    </article>
  );
}
