'use client';

import Link from 'next/link';
import { ArrowRight, BookOpen, Eye, GraduationCap, HandCoins, Handshake, UserRoundCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { useTrainingProgrammes } from '@/lib/hooks/use-international';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { TrainingProgrammeCard } from '@/components/international/training-programme-card';

/**
 * For local caregivers thinking about work abroad: the platform's training
 * (English and basic caregiving - not tied to any one country), the option to
 * share a profile with overseas employers, and the promise that matters most
 * on this path - caregivers never pay a placement fee.
 */
export default function WorkAbroadPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const { data: programmes = [], isLoading } = useTrainingProgrammes(locale);
  const isCaregiver = user?.role === 'CAREGIVER';

  const benefits = [
    { icon: GraduationCap, key: 'train' },
    { icon: UserRoundCheck, key: 'share' },
    { icon: Handshake, key: 'connect' },
    { icon: HandCoins, key: 'noFees' },
  ] as const;
  const steps = [1, 2, 3, 4].map((n) => ({ title: t(`workAbroad.steps.step${n}Title`), body: t(`workAbroad.steps.step${n}Body`) }));

  const primary = isCaregiver ? (
    <Link href="/caregiver/work-abroad" className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-brand-dark hover:bg-white/90">
      {t('workAbroad.ctaOpen')}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  ) : (
    <>
      <Link href="/caregiver/signup" className="inline-flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-semibold text-brand-dark hover:bg-white/90">
        {t('workAbroad.ctaJoin')}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
      <Link href="/caregiver/login" className="inline-flex items-center rounded border border-white/40 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
        {t('workAbroad.ctaSignIn')}
      </Link>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="full" />

      <main className="flex-1">
        <section className="relative overflow-hidden bg-accent-dark text-white">
          <div className="absolute inset-0 bg-gradient-to-br from-accent via-accent-dark to-brand-dark opacity-95" aria-hidden />
          <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide">{t('workAbroad.pill')}</span>
            <h1 className="mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">{t('workAbroad.heroTitle')}</h1>
            <p className="mt-4 max-w-2xl text-white/85">{t('workAbroad.heroBody')}</p>
            <div className="mt-8 flex flex-wrap gap-3">{primary}</div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto grid max-w-5xl gap-4 px-4 sm:grid-cols-2">
            {benefits.map(({ icon: Icon, key }) => (
              <div key={key} className="flex gap-4 rounded-lg border border-border bg-white p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-accent-light text-accent-dark">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-ink">{t(`workAbroad.benefits.${key}Title`)}</h2>
                  <p className="mt-1 text-sm text-ink/60">{t(`workAbroad.benefits.${key}Body`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-white py-16">
          <div className="mx-auto max-w-5xl px-4">
            <div className="flex items-center gap-2 text-accent">
              <BookOpen className="h-5 w-5" aria-hidden />
              <p className="text-xs font-bold uppercase tracking-[0.1em]">{t('workAbroad.training.eyebrow')}</p>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('workAbroad.training.title')}</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink/60">{t('workAbroad.training.body')}</p>
            {isLoading && <div className="mt-8 h-32 animate-pulse rounded-lg bg-paper" aria-hidden />}
            {!isLoading && programmes.length === 0 && (
              <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink/60">{t('workAbroad.training.empty')}</p>
            )}
            {programmes.length > 0 && (
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {programmes.map((p) => (
                  <TrainingProgrammeCard key={p.id} programme={p} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-3xl px-4">
            <h2 className="text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">{t('workAbroad.steps.title')}</h2>
            <ol className="mt-10 space-y-3">
              {steps.map((step, i) => (
                <li key={step.title} className="flex gap-4 rounded-lg border border-border bg-white p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">{i + 1}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1 text-sm text-ink/60">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex gap-3 rounded-lg border border-accent/30 bg-accent/5 p-5">
              <Eye className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-ink">{t('workAbroad.privacy.title')}</h3>
                <p className="mt-1 text-sm text-ink/70">{t('workAbroad.privacy.body')}</p>
              </div>
            </div>

            <div className="mt-10 flex flex-wrap justify-center gap-3 rounded-lg bg-gradient-to-br from-accent to-brand p-8 text-center">
              <p className="w-full text-lg font-semibold text-white">{t('workAbroad.ctaTitle')}</p>
              {primary}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
