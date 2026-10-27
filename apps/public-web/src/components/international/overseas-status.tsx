'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarCheck2, FileClock, Plane, Search } from 'lucide-react';
import type { ExpiryState } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate } from '@/lib/colombo-time';
import { ApiError } from '@/lib/api/client';
import { useApplicationActions, useMyApplications, useMyDatedDocuments, useMyPlacements } from '@/lib/hooks/use-international';
import { cn } from '@/lib/utils';

const STATE_STYLE: Record<ExpiryState, string> = {
  VALID: 'bg-brand-light text-brand-dark',
  EXPIRING: 'bg-amber-100 text-amber-900',
  EXPIRED: 'bg-red-100 text-red-800',
};

/**
 * The caregiver's placement abroad - where, with what kind of employer, and
 * the dates. Never the employer's name: our team is their contact, and the
 * people to call if anything goes wrong.
 */
export function MyPlacementCard() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data = [] } = useMyPlacements();
  const current = data.find((p) => p.status === 'PRE_DEPARTURE' || p.status === 'DEPLOYED');
  if (!current) return null;
  const dates: [string, string | null][] = [
    ['departure', current.departureOn],
    ['arrived', current.arrivedOn],
    ['contractStart', current.contractStartOn],
    ['contractEnd', current.contractEndsOn],
  ];
  return (
    <section aria-labelledby="placement-title" className="rounded-lg border border-brand/40 bg-brand-light/40 p-5 sm:p-6">
      <h2 id="placement-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Plane className="h-5 w-5 text-brand" aria-hidden />
        {t('portal.workAbroad.placement.title')}
      </h2>
      <p className="mt-1 text-sm text-ink/80">
        {current.jobTitle ? `${current.jobTitle} · ` : ''}
        {t('portal.workAbroad.interest.who', { type: t(`international.employerTypes.${current.organisationType}`), country: countries.name(current.country) })}
      </p>
      <p className="mt-2 inline-block rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-dark">{t(`portal.workAbroad.placement.status.${current.status}`)}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {dates
          .filter(([, d]) => d)
          .map(([key, d]) => (
            <div key={key} className="flex justify-between gap-3 border-b border-white pb-1">
              <dt className="text-ink/60">{t(`portal.workAbroad.placement.${key}`)}</dt>
              <dd className="tabular-nums text-ink">{fmtDate(d!, locale)}</dd>
            </div>
          ))}
      </dl>
      <p className="mt-4 text-sm text-ink/70">{t('portal.workAbroad.placement.help')}</p>
    </section>
  );
}

/** Vacancies the caregiver applied for, and where each stands. */
export function MyApplicationsCard() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data = [], isLoading } = useMyApplications();
  const { withdraw } = useApplicationActions();

  return (
    <section id="applications" aria-labelledby="applications-title" className="scroll-mt-6 rounded-lg border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="applications-title" className="text-lg font-semibold text-ink">
            {t('portal.workAbroad.applications.title')}
          </h2>
          <p className="mt-1 text-sm text-ink/60">{t('portal.workAbroad.applications.intro')}</p>
        </div>
        <Link href="/work-abroad/vacancies" className="inline-flex items-center gap-2 rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
          <Search className="h-4 w-4" aria-hidden />
          {t('portal.workAbroad.applications.browse')}
        </Link>
      </div>
      {isLoading && <div className="mt-4 h-16 animate-pulse rounded bg-paper" aria-hidden />}
      {!isLoading && data.length === 0 && <p className="mt-4 text-sm text-ink/60">{t('portal.workAbroad.applications.none')}</p>}
      {data.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded border border-border">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <Link href={`/work-abroad/vacancies/${a.vacancy.reference}`} className="text-sm font-medium text-ink hover:text-brand-dark hover:underline">
                  {a.vacancy.title}
                </Link>
                <p className="text-xs text-ink/60">
                  {[a.vacancy.city, countries.name(a.vacancy.country)].filter(Boolean).join(', ')} · {t('vacancies.apply.sentOn', { date: fmtDate(a.createdAt.slice(0, 10), locale) })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', a.status === 'PUT_FORWARD' ? 'bg-brand text-white' : a.status === 'NOT_SUCCESSFUL' ? 'bg-ink/10 text-ink/60' : 'bg-accent-light text-accent-dark')}>
                  {!a.vacancy.open && a.status === 'APPLIED' ? t('portal.workAbroad.applications.closed') : t(`vacancies.apply.status.${a.status}`)}
                </span>
                {a.status === 'APPLIED' && (
                  <button type="button" onClick={() => withdraw.mutate(a.id)} disabled={withdraw.isPending} className="text-xs text-danger hover:underline disabled:opacity-50">
                    {t('portal.workAbroad.applications.withdraw')}
                    <span className="sr-only">: {a.vacancy.title}</span>
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {withdraw.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {withdraw.error instanceof ApiError ? withdraw.error.message : t('portal.saveError')}
        </p>
      )}
    </section>
  );
}

/** Passport and dated documents, and how long each has left. */
export function DatedDocumentsCard() {
  const { t, locale } = useTranslation();
  const { data = [] } = useMyDatedDocuments();
  if (!data.length) return null;
  const urgent = data.some((d) => d.state !== 'VALID');

  return (
    <section aria-labelledby="dated-title" className={cn('rounded-lg border p-5 sm:p-6', urgent ? 'border-amber-300 bg-amber-50' : 'border-border bg-white')}>
      <h2 id="dated-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        {urgent ? <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden /> : <FileClock className="h-5 w-5 text-brand" aria-hidden />}
        {t('portal.workAbroad.dated.title')}
      </h2>
      <p className="mt-1 text-sm text-ink/70">{t('portal.workAbroad.dated.intro')}</p>
      <ul className="mt-4 space-y-2">
        {data.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center justify-between gap-3 rounded bg-white px-4 py-2.5 text-sm">
            <span className="font-medium text-ink">{t(`portal.documents.types.${d.documentType}`)}</span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-ink/70">{fmtDate(d.expiresOn, locale)}</span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATE_STYLE[d.state])}>
                {d.state === 'EXPIRED' ? t('portal.workAbroad.dated.expired') : d.state === 'EXPIRING' ? t('portal.workAbroad.dated.daysLeft', { days: d.daysLeft }) : t('portal.workAbroad.dated.valid')}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {urgent && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink/80">
          <CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <span>
            {t('portal.workAbroad.dated.renew')}{' '}
            <Link href="/caregiver/documents" className="font-semibold text-brand underline-offset-2 hover:underline">
              {t('portal.workAbroad.dated.upload')}
            </Link>
          </span>
        </p>
      )}
    </section>
  );
}
