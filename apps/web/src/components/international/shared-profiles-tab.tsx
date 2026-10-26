'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, ImageOff, X } from 'lucide-react';
import type { SharedProfileReviewItem } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useReviewSharedProfile, useSharedProfilePhoto, useSharedProfileQueue } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const FILTERS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'all'] as const;

/**
 * Shared profiles waiting for review. Staff check exactly what will be shown
 * publicly - the photo is a face (is it the caregiver, is it appropriate?),
 * and the headline and introduction must not carry a phone number, email,
 * address or anything else that bypasses the staff-mediated contact model.
 */
export function SharedProfilesTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING_REVIEW');
  const { data = [], isLoading } = useSharedProfileQueue(filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.profiles.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.profiles.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.profiles.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.profiles.empty')}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((item) => (
          <ReviewCard key={item.caregiverId} item={item} />
        ))}
      </div>
    </div>
  );
}

const CONTACT_PATTERN = /(\+?\d[\d\s-]{7,}\d)|([^\s@]+@[^\s@]+\.[^\s@]+)|(wa\.me|whatsapp|viber|telegram|facebook\.com|instagram)/i;

function ReviewCard({ item }: { item: SharedProfileReviewItem }) {
  const { t } = useTranslation();
  const review = useReviewSharedProfile();
  const { data: photo } = useSharedProfilePhoto(item.caregiverId, item.hasPhoto, item.updatedAt);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A nudge, not a rule: staff decide. Flags text that looks like a way to bypass us.
  const looksLikeContact = CONTACT_PATTERN.test(`${item.headline ?? ''} ${item.bio ?? ''}`);

  const decide = (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && !note.trim()) return setError(t('international.profiles.noteRequired'));
    review.mutate({ caregiverId: item.caregiverId, decision, note: note.trim() || undefined }, { onError: (e) => setError(e instanceof Error ? e.message : String(e)) });
  };

  return (
    <article className="rounded-lg border border-border bg-white p-5">
      <div className="flex gap-4">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={item.firstName} className="h-24 w-24 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full bg-paper text-center text-[10px] text-ink/40">
            <ImageOff size={20} aria-hidden />
            {t('international.profiles.noPhoto')}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">{item.firstName}</h3>
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                item.status === 'APPROVED' ? 'bg-brand-light text-brand-dark' : item.status === 'REJECTED' ? 'bg-danger-light text-danger' : 'bg-accent-light text-accent',
              )}
            >
              {t(`international.profiles.status.${item.status}`)}
            </span>
            {!item.isShared && <span className="rounded bg-ink/10 px-2 py-0.5 text-xs text-ink/60">{t('international.profiles.paused')}</span>}
          </div>
          <Link href={`/caregivers/${item.caregiverId}`} className="text-xs text-ink/60 hover:text-brand-dark hover:underline">
            {item.fullName} · {item.registrationNumber}
          </Link>
          {item.headline && <p className="mt-2 text-sm font-medium text-ink/80">{item.headline}</p>}
          {item.bio && <p className="mt-1 whitespace-pre-line text-sm text-ink/70">{item.bio}</p>}
        </div>
      </div>

      <p className="mt-3 text-xs text-ink/50">
        {item.consentAcceptedAt ? t('international.profiles.consentOn', { date: new Date(item.consentAcceptedAt).toLocaleString() }) : t('international.profiles.noConsent')}
        {' · '}
        {t('international.profiles.updated', { date: new Date(item.updatedAt).toLocaleString() })}
      </p>
      {looksLikeContact && <p className="mt-2 rounded bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">{t('international.profiles.contactWarning')}</p>}
      {item.status === 'REJECTED' && item.reviewNote && <p className="mt-2 text-xs text-danger">{t('international.profiles.lastNote', { note: item.reviewNote })}</p>}

      {(item.status === 'PENDING_REVIEW' || item.status === 'APPROVED') && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('international.profiles.notePlaceholder')} maxLength={500} />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {item.status === 'PENDING_REVIEW' && (
              <Button size="sm" disabled={review.isPending || !item.consentAcceptedAt} onClick={() => decide('APPROVE')}>
                <Check size={14} aria-hidden />
                {t('international.profiles.approve')}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('REJECT')}>
              <X size={14} aria-hidden />
              {item.status === 'APPROVED' ? t('international.profiles.takeDown') : t('international.profiles.reject')}
            </Button>
            {item.status === 'APPROVED' && item.isShared && (
              <a href={`/talent/${item.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-dark hover:underline">
                <ExternalLink size={14} aria-hidden />
                {t('international.profiles.viewLive')}
              </a>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
