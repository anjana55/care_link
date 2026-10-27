'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, HandCoins, ShieldCheck } from 'lucide-react';
import { VACANCY_LIMITS } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { fmtDate } from '@/lib/colombo-time';
import { rememberReturnTo } from '@/lib/return-to';
import { useApplicationActions, useMyApplications, useSharedProfile, useVacancy } from '@/lib/hooks/use-international';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { VacancyFacts } from '@/components/international/vacancy-card';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';

/** One vacancy, and applying for it. */
export default function VacancyPage() {
  const { t, locale } = useTranslation();
  const { reference } = useParams<{ reference: string }>();
  const { data: v, isLoading, isError } = useVacancy(reference?.toUpperCase() ?? null);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="full" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Link href="/work-abroad/vacancies" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t('vacancies.back')}
        </Link>
        {isLoading && <div className="mt-6 h-64 animate-pulse rounded-lg bg-white" aria-hidden />}
        {(isError || (!isLoading && !v)) && (
          <div className="mt-6 rounded-lg border border-border bg-white p-8 text-center">
            <h1 className="text-lg font-semibold text-ink">{t('vacancies.notFound')}</h1>
            <p className="mt-2 text-sm text-ink/60">{t('vacancies.notFoundBody')}</p>
          </div>
        )}
        {v && (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
            <article className="rounded-lg border border-border bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t('vacancies.roles', { count: v.rolesCount })}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">{v.title}</h1>
              <div className="mt-4">
                <VacancyFacts vacancy={v} full />
              </div>
              <h2 className="mt-6 text-sm font-semibold text-ink">{t('vacancies.about')}</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink/80">{v.description}</p>
              <h2 className="mt-6 text-sm font-semibold text-ink">{t('vacancies.need')}</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
                <li>{v.minExperienceYears > 0 ? t('vacancies.experience', { years: v.minExperienceYears }) : t('vacancies.noExperience')}</li>
                <li>{t(`vacancies.english.${v.englishLevel}`)}</li>
                <li>{t(`vacancies.visa.${v.visaSponsorship}`)}</li>
              </ul>
              {v.requirements && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink/80">{v.requirements}</p>}
              <p className="mt-6 text-xs text-ink/50">
                {t('vacancies.reference', { reference: v.reference })} · {t('vacancies.posted', { date: fmtDate(v.publishedAt.slice(0, 10), locale) })}
                {v.closesOn && <> · {t('vacancies.closes', { date: fmtDate(v.closesOn, locale) })}</>}
              </p>
            </article>
            <aside className="space-y-4">
              <ApplyPanel reference={v.reference} title={v.title} />
              <div className="rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm text-ink/80">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <HandCoins className="h-4 w-4 text-accent" aria-hidden />
                  {t('vacancies.noFeesTitle')}
                </p>
                <p className="mt-1">{t('vacancies.noFeesBody')}</p>
              </div>
              <div className="rounded-lg border border-border bg-white p-4 text-sm text-ink/70">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
                  {t('vacancies.howTitle')}
                </p>
                <p className="mt-1">{t('vacancies.howBody')}</p>
              </div>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function ApplyPanel({ reference, title }: { reference: string; title: string }) {
  const { t, locale } = useTranslation();
  const { user, loading } = useAuth();
  const isCaregiver = user?.role === 'CAREGIVER';
  const { data: applications = [] } = useMyApplications();
  const { data: shared } = useSharedProfile();
  const { apply } = useApplicationActions();
  const [message, setMessage] = useState('');
  const existing = applications.find((a) => a.vacancy.reference === reference);

  const box = (children: React.ReactNode) => (
    <section aria-labelledby="apply-title" className="rounded-lg border border-brand/30 bg-white p-5">
      <h2 id="apply-title" className="text-base font-semibold text-ink">
        {t('vacancies.apply.title')}
      </h2>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );

  if (loading) return box(<div className="h-16 animate-pulse rounded bg-paper" aria-hidden />);

  if (!user) {
    const here = `/work-abroad/vacancies/${reference}`;
    return box(
      <>
        <p className="text-ink/70">{t('vacancies.apply.signInFirst')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/caregiver/login" onClick={() => rememberReturnTo(here)} className="inline-flex items-center rounded bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            {t('vacancies.apply.signIn')}
          </Link>
          <Link href="/caregiver/signup" onClick={() => rememberReturnTo(here)} className="inline-flex items-center rounded border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-paper">
            {t('vacancies.apply.join')}
          </Link>
        </div>
      </>,
    );
  }

  if (!isCaregiver) return box(<p className="text-ink/70">{t('vacancies.apply.caregiversOnly')}</p>);

  if (existing) {
    return box(
      <>
        <p className="flex items-center gap-2 font-medium text-brand-dark">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t(`vacancies.apply.status.${existing.status}`)}
        </p>
        <p className="mt-1 text-xs text-ink/60">{t('vacancies.apply.sentOn', { date: fmtDate(existing.createdAt.slice(0, 10), locale) })}</p>
        <Link href="/caregiver/work-abroad#applications" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
          {t('vacancies.apply.seeAll')}
        </Link>
      </>,
    );
  }

  return box(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply.mutate({ reference, message: message.trim() || undefined });
      }}
    >
      {!shared?.isLive && (
        <p className="mb-3 rounded bg-accent-light/60 px-3 py-2 text-xs text-ink/80">
          {t('vacancies.apply.shareFirst')}{' '}
          <Link href="/caregiver/work-abroad#share" className="font-semibold text-brand underline-offset-2 hover:underline">
            {t('vacancies.apply.shareLink')}
          </Link>
        </p>
      )}
      <Label htmlFor="apply-message">{t('vacancies.apply.message')}</Label>
      <Textarea id="apply-message" rows={4} value={message} maxLength={VACANCY_LIMITS.applicationMessage} onChange={(e) => setMessage(e.target.value)} placeholder={t('vacancies.apply.messagePlaceholder')} />
      <p className="mt-1 text-xs text-ink/50">{t('vacancies.apply.messageHint')}</p>
      {apply.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {apply.error instanceof ApiError ? apply.error.message : t('portal.saveError')}
        </p>
      )}
      <Button type="submit" className="mt-3 w-full" disabled={apply.isPending}>
        {apply.isPending ? t('common.loading') : t('vacancies.apply.button')}
        <span className="sr-only">: {title}</span>
      </Button>
    </form>,
  );
}
