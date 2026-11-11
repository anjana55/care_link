'use client';

import { useState } from 'react';
import { CARE_OFFER_DECLINE_REASONS, type CareOfferDeclineReason, type CaregiverCareOffer } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { fmtDate, fmtDateTime } from '@/lib/colombo-time';
import { useAnswerCareOffer, useCareOffers } from '@/lib/hooks/use-caregiver-portal';
import { useMarkPathsRead } from '@/lib/hooks/use-notifications';

const money = (n: number) => n.toLocaleString('en-LK');
const STATUS_STYLES: Record<CaregiverCareOffer['status'], string> = {
  OFFERED: 'bg-accent-light text-accent',
  ACCEPTED: 'bg-brand-light text-brand-dark',
  DECLINED: 'bg-ink/10 text-ink/70',
  EXPIRED: 'bg-ink/10 text-ink/70',
  WITHDRAWN: 'bg-ink/10 text-ink/70',
};

/**
 * The caregiver's job offers. Each waiting offer says what the job is (kind of
 * care, area, start, pay), until when they can answer, and has two large
 * buttons. Nothing here identifies the client: that comes with the booking.
 */
export default function CareOffersPage() {
  useMarkPathsRead(['/care-offers']);
  const { t, locale } = useTranslation();
  const { data, isLoading, isError } = useCareOffers();
  const answer = useAnswerCareOffer();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState<CareOfferDeclineReason | ''>('');
  const [error, setError] = useState<{ offerId: string; text: string } | null>(null);

  const fail = (offerId: string) => (err: unknown) => setError({ offerId, text: err instanceof ApiError ? err.message : t('portal.offers.error') });
  const waiting = data?.filter((o) => o.status === 'OFFERED') ?? [];
  const earlier = data?.filter((o) => o.status !== 'OFFERED') ?? [];

  const details = (o: CaregiverCareOffer) => (
    <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-ink/60">{t('portal.offers.where')}</dt>
        <dd className="font-medium text-ink">{[o.city?.[locale], o.district?.[locale]].filter(Boolean).join(', ') || '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink/60">{t('portal.offers.starts')}</dt>
        <dd className="font-medium text-ink">{o.desiredStartDate ? fmtDate(o.desiredStartDate, locale) : t('portal.offers.startsOpen')}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink/60">{t('portal.offers.rate')}</dt>
        <dd className="font-medium text-ink">
          {o.payRate !== null && o.rateType ? t('portal.offers.rateValue', { amount: money(o.payRate), unit: t(`portal.offers.units.${o.rateType}`) }) : t('portal.offers.rateOpen')}
        </dd>
      </div>
    </dl>
  );

  const card = (o: CaregiverCareOffer) => (
    <li key={o.id} className="rounded-lg border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink">{o.careType ? t(`careTypes.${o.careType}`) : t('portal.offers.title')}</h3>
          <p className="text-xs text-ink/60">{t('portal.offers.reference', { reference: o.reference })}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[o.status]}`}>{t(`portal.offers.statuses.${o.status}`)}</span>
      </div>
      {details(o)}
      {o.note && (
        <p className="mt-3 rounded bg-paper px-3 py-2 text-sm text-ink">
          <span className="block text-xs text-ink/60">{t('portal.offers.note')}</span>
          {o.note}
        </p>
      )}
      {o.status === 'ACCEPTED' && <p className="mt-3 text-sm text-brand-dark">{t('portal.offers.accepted')}</p>}
      {o.status === 'OFFERED' && (
        <>
          <p className="mt-3 text-sm font-medium text-accent">{t('portal.offers.answerBy', { when: fmtDateTime(o.expiresAt, locale) })}</p>
          <p className="text-xs text-ink/60">{t('portal.offers.privacy')}</p>
          {error?.offerId === o.id && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error.text}
            </p>
          )}
          {declining === o.id ? (
            <fieldset className="mt-3 rounded border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-ink">{t('portal.offers.declineTitle')}</legend>
              <p className="mb-2 text-xs text-ink/60">{t('portal.offers.declineHint')}</p>
              {CARE_OFFER_DECLINE_REASONS.map((r) => (
                <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                  <input type="radio" name={`reason-${o.id}`} className="h-5 w-5 accent-brand" checked={reason === r} onChange={() => setReason(r)} />
                  {t(`portal.offers.reasons.${r}`)}
                </label>
              ))}
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={answer.isPending}
                  onClick={() => answer.mutate({ offerId: o.id, accept: false, reason: reason || undefined }, { onSuccess: () => (setDeclining(null), setReason(''), setError(null)), onError: fail(o.id) })}
                  className="inline-flex h-11 items-center rounded bg-danger px-5 text-sm font-medium text-white hover:bg-danger/90 disabled:opacity-50"
                >
                  {t('portal.offers.confirmDecline')}
                </button>
                <button type="button" onClick={() => (setDeclining(null), setReason(''))} className="inline-flex h-11 items-center rounded border border-border bg-white px-5 text-sm font-medium text-ink hover:bg-paper">
                  {t('portal.offers.back')}
                </button>
              </div>
            </fieldset>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => (setError(null), answer.mutate({ offerId: o.id, accept: true }, { onError: fail(o.id) }))}
                className="inline-flex h-12 items-center rounded bg-brand px-6 text-base font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {answer.isPending && answer.variables?.offerId === o.id && answer.variables.accept ? t('common.loading') : t('portal.offers.accept')}
              </button>
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => (setError(null), setDeclining(o.id))}
                className="inline-flex h-12 items-center rounded border border-border bg-white px-6 text-base font-medium text-ink hover:bg-paper disabled:opacity-50"
              >
                {t('portal.offers.decline')}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('portal.offers.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('portal.offers.subtitle')}</p>
      </div>
      {isLoading && <p className="text-sm text-ink/60">{t('common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-danger">
          {t('portal.loadError')}
        </p>
      )}
      {data && data.length === 0 && <p className="rounded-lg border border-border bg-white p-5 text-sm text-ink/70">{t('portal.offers.none')}</p>}
      {waiting.length > 0 && (
        <section aria-labelledby="offers-waiting">
          <h2 id="offers-waiting" className="mb-2 text-sm font-semibold text-ink">
            {t('portal.offers.waiting')}
          </h2>
          <ul className="space-y-3">{waiting.map(card)}</ul>
        </section>
      )}
      {earlier.length > 0 && (
        <section aria-labelledby="offers-earlier">
          <h2 id="offers-earlier" className="mb-2 text-sm font-semibold text-ink">
            {t('portal.offers.earlier')}
          </h2>
          <ul className="space-y-3">{earlier.map(card)}</ul>
        </section>
      )}
    </div>
  );
}
