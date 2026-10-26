'use client';

import Link from 'next/link';
import { Briefcase, CalendarClock, CheckCircle2, Circle } from 'lucide-react';
import type { ReadinessItem } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useEmployerInterest, useReadinessChecklist } from '@/lib/hooks/use-international';

/** Where each unfinished item is fixed. */
const FIX: Record<ReadinessItem, string> = {
  registrationVerified: '/caregiver/documents',
  openToOverseas: '#readiness',
  passportValid: '#readiness',
  policeClearance: '/caregiver/documents',
  english: '#training',
  caregiving: '#training',
  sharedProfile: '#share',
};

/**
 * "How ready am I?" - a short list the caregiver can work through, not tied
 * to any one country. Each item is checked by the API from things staff
 * verify, so ticking it here is never the caregiver's own claim.
 */
export function ReadinessChecklist() {
  const { t } = useTranslation();
  const { data } = useReadinessChecklist();
  if (!data) return null;
  const pct = Math.round((data.done / data.total) * 100);

  return (
    <section aria-labelledby="ready-title" className="rounded-lg border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ready-title" className="text-lg font-semibold text-ink">
          {t('portal.workAbroad.checklist.title')}
        </h2>
        <span className="text-sm font-semibold tabular-nums text-brand-dark">{t('portal.workAbroad.checklist.progress', { done: data.done, total: data.total })}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} aria-label={t('portal.workAbroad.checklist.title')}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.items.map(({ key, done }) => (
          <li key={key} className="flex items-start gap-2.5 text-sm">
            {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink/25" aria-hidden />}
            <span>
              <span className={done ? 'text-ink' : 'font-medium text-ink'}>{t(`portal.workAbroad.checklist.items.${key}`)}</span>
              <span className="sr-only">: {done ? t('portal.workAbroad.checklist.done') : t('portal.workAbroad.checklist.todo')}</span>
              {!done && (
                <Link href={FIX[key]} className="block text-xs text-brand underline-offset-2 hover:underline">
                  {t(`portal.workAbroad.checklist.hints.${key}`)}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-ink/50">{t('portal.workAbroad.checklist.note')}</p>
    </section>
  );
}

/** Employers who are interested - the country and kind of employer only. Staff call with details. */
export function EmployerInterestCard() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data = [] } = useEmployerInterest();
  const active = data.filter((i) => i.status !== 'NOT_PROCEEDING');
  if (!active.length) return null;

  return (
    <section aria-labelledby="interest-title" className="rounded-lg border border-accent/40 bg-accent/5 p-5 sm:p-6">
      <h2 id="interest-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
        <Briefcase className="h-5 w-5 text-accent" aria-hidden />
        {t('portal.workAbroad.interest.title')}
      </h2>
      <p className="mt-1 text-sm text-ink/70">{t('portal.workAbroad.interest.intro')}</p>
      <ul className="mt-4 space-y-2">
        {active.map((i) => (
          <li key={i.id} className="rounded-DEFAULT bg-white px-4 py-3 text-sm">
            <p className="font-medium text-ink">
              {t('portal.workAbroad.interest.who', { type: t(`international.employerTypes.${i.organisationType}`), country: countries.name(i.country) })}
            </p>
            <p className="text-xs text-ink/60">{t(`portal.workAbroad.interest.status.${i.status}`)}</p>
            {i.interviewAt && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-brand-dark">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                {new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(i.interviewAt))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
