'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CareOfferStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { fmtTime } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';
import { useSendCoverOffers, useShiftCover, useWithdrawCoverOffer } from '@/lib/hooks/use-cover';
import { Button } from '@/components/ui/button';
import { PhoneLink } from '@/components/clients/contact-links';

const STATUS_STYLES: Record<CareOfferStatus, string> = {
  OFFERED: 'bg-accent-light text-accent',
  ACCEPTED: 'bg-brand-light text-brand-dark',
  DECLINED: 'bg-danger-light text-danger',
  EXPIRED: 'bg-ink/10 text-ink/70',
  WITHDRAWN: 'bg-ink/10 text-ink/70',
};
/** Ticked to begin with: the same number the agent would ask at once. */
const PRESELECTED = 3;
const money = (n: number) => n.toLocaleString('en-LK');

/**
 * Cover for one shift: who has been asked and what they said, and who else
 * could take it - free at that time and in the area, best placed first.
 * Staff tick the caregivers to ask; the first to accept is put on the shift.
 */
export function CoverPanel({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useShiftCover(shiftId);
  const send = useSendCoverOffers(shiftId);
  const withdraw = useWithdrawCoverOffer(shiftId);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Once someone has taken the shift the list of others is out of the way, until staff ask for it (the cover cannot come either).
  const [again, setAgain] = useState(false);

  // The first few are ticked once, when the list first arrives; after that the ticks are the staff member's own.
  useEffect(() => {
    if (data && picked === null) setPicked(new Set(data.suggestions.slice(0, PRESELECTED).map((s) => s.caregiverId)));
  }, [data, picked]);

  const message = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t('visits.coverPanel.error'));
  if (isLoading || !data) return <p className="mt-3 border-t border-border pt-3 text-sm text-ink/50">{t('common.loading')}</p>;

  const chosen = data.suggestions.filter((s) => picked?.has(s.caregiverId));
  const accepted = data.offers.find((o) => o.status === 'ACCEPTED' && o.caregiver.id === data.caregiver.id);
  const waiting = data.offers.some((o) => o.status === 'OFFERED');
  const showSuggestions = !data.blocked && (!accepted || again);
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section aria-label={t('visits.coverPanel.title')} className="mt-3 space-y-3 border-t border-border pt-3" data-testid={`cover-${shiftId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('visits.coverPanel.title')}</h3>
        <p className="text-xs text-ink/60">
          {data.pay ? t('visits.coverPanel.pay', { amount: money(data.pay.amount), unit: t(`pricing.units.${data.pay.rateType}`) }) : t('visits.coverPanel.payOpen')}
        </p>
      </div>

      {accepted && <p className="rounded bg-brand-light px-3 py-2 text-sm text-brand-dark">{t('visits.coverPanel.accepted', { name: accepted.caregiver.fullName })}</p>}
      {data.blocked && !accepted && <p className="text-sm text-ink/70">{t(`visits.coverPanel.blocked.${data.blocked}`)}</p>}
      {data.billedOn && !data.blocked && !accepted && <p className="text-xs text-ink/60">{t('visits.coverPanel.billed', { doc: data.billedOn })}</p>}

      {data.offers.length > 0 && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-ink/50">{t('visits.coverPanel.asked')}</h4>
          <ul>
            {data.offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
                <div className="min-w-0 flex-1 basis-56 text-sm">
                  <Link href={`/caregivers/${o.caregiver.id}`} className="font-medium text-ink hover:underline">
                    {o.caregiver.fullName}
                  </Link>
                  <span className="ml-2 text-xs text-ink/50">{o.caregiver.registrationNumber}</span>
                  <p className="text-xs text-ink/50">
                    {o.status === 'OFFERED' ? t('careOffers.until', { when: fmtTime(o.expiresAt, locale) }) : o.respondedAt ? t('careOffers.answered', { when: fmtTime(o.respondedAt, locale) }) : fmtTime(o.expiresAt, locale)}
                    {o.sentByName && ` · ${t('careOffers.by', { name: o.sentByName })}`}
                  </p>
                </div>
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[o.status])}>
                  {t(`careOffers.statuses.${o.status}`)}
                  {o.declineReason && `: ${t(`careOffers.reasons.${o.declineReason}`)}`}
                </span>
                {o.status === 'OFFERED' && (
                  <Button size="sm" variant="secondary" disabled={withdraw.isPending} onClick={() => (setError(null), withdraw.mutate(o.id, { onError: (e) => setError(message(e)) }))}>
                    {t('careOffers.withdraw')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showSuggestions && (
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-ink/50">{t('visits.coverPanel.suggested')}</h4>
          {data.suggestions.length === 0 ? (
            <p className="mt-1 text-sm text-ink/70">{waiting ? t('visits.coverPanel.noneLeft') : t('visits.coverPanel.none')}</p>
          ) : (
            <>
              <p id={`cover-hint-${shiftId}`} className="mt-1 text-xs text-ink/60">
                {t('visits.coverPanel.suggestedHint', { minutes: data.offerMinutes })}
              </p>
              <ul aria-describedby={`cover-hint-${shiftId}`}>
                {data.suggestions.map((s) => (
                  <li key={s.caregiverId} className="border-t border-border py-2 first:border-t-0">
                    <label className="flex cursor-pointer items-start gap-3 text-sm">
                      <input type="checkbox" className="mt-1" checked={picked?.has(s.caregiverId) ?? false} onChange={() => toggle(s.caregiverId)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{s.fullName}</span>
                        <span className="ml-2 text-xs text-ink/50">{s.registrationNumber}</span>
                        <span className="block text-xs text-ink/60">{s.reasons.join(' · ')}</span>
                      </span>
                    </label>
                    {s.phone && (
                      <p className="ml-7 text-xs">
                        <PhoneLink phone={s.phone} whatsapp />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!data.blocked && accepted && !again && (
          <Button size="sm" variant="secondary" onClick={() => setAgain(true)}>
            {t('visits.coverPanel.again')}
          </Button>
        )}
        {showSuggestions && data.suggestions.length > 0 && (
          <Button
            size="sm"
            disabled={send.isPending || chosen.length === 0}
            onClick={() => (setError(null), send.mutate({ caregiverIds: chosen.map((s) => s.caregiverId) }, { onSuccess: () => setPicked(new Set()), onError: (e) => setError(message(e)) }))}
          >
            {send.isPending ? t('common.loading') : t('visits.coverPanel.send', { n: chosen.length })}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t('visits.coverPanel.close')}
        </Button>
      </div>
    </section>
  );
}
