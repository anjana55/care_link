'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BadgeCheck, MapPin, Languages as LanguagesIcon } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useCaregiverProfile } from '@/lib/hooks/use-public-search';
import { ApiError } from '@/lib/api/client';
import { LoadingState, ErrorState } from '@/components/common/states';
import { RegistrationGate } from '@/components/common/registration-gate';
import { LanguageSwitcher } from '@/components/common/language-switcher';

export default function CaregiverProfilePage() {
  const { t } = useTranslation();
  const params = useParams<{ publicId: string }>();
  const { data: caregiver, isLoading, isError, error, refetch } = useCaregiverProfile(params.publicId);
  const [gateOpen, setGateOpen] = useState(false);
  const isNotFound = error instanceof ApiError && error.status === 404;

  return (
    <main className="min-h-screen">
      <header className="border-b border-border bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-medium text-ink/60 hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('profile.backToResults')}
          </Link>
          <LanguageSwitcher />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        {isLoading && <LoadingState label={t('loading.searching')} />}
        {isError && isNotFound && <p className="py-16 text-center text-sm text-ink/60">{t('profile.notFound')}</p>}
        {isError && !isNotFound && <ErrorState onRetry={() => refetch()} />}

        {caregiver && (
          <article className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
              {t('profile.anonymousId', { id: caregiver.publicId.slice(0, 8) })}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-ink">
              {caregiver.gender === 'FEMALE' ? '♀' : caregiver.gender === 'MALE' ? '♂' : ''} {caregiver.approxAge} years
            </h1>
            <p className="mt-1 text-sm text-ink/60">{t('results.yearsExperience', { years: caregiver.yearsExperience })}</p>

            {caregiver.hasVerifiedQualification && (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand-dark">
                <BadgeCheck className="h-4 w-4" aria-hidden />
                {t('results.verifiedQualification')}
              </p>
            )}

            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {t('profile.district')} / {t('profile.city')}
                </dt>
                <dd className="mt-1 text-sm text-ink/80">{[caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—'}</dd>
              </div>

              {caregiver.preferredLocations.length > 0 && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('profile.preferredLocations')}</dt>
                  <dd className="mt-1 text-sm text-ink/80">{caregiver.preferredLocations.join(', ')}</dd>
                </div>
              )}

              {caregiver.languages.length > 0 && (
                <div>
                  <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">
                    <LanguagesIcon className="h-3.5 w-3.5" aria-hidden />
                    {t('profile.languages')}
                  </dt>
                  <dd className="mt-1 text-sm text-ink/80">{caregiver.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}</dd>
                </div>
              )}

              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('profile.availability')}</dt>
                <dd className="mt-1 text-sm text-ink/80">
                  {[
                    caregiver.availability.dayDuty && 'Day',
                    caregiver.availability.nightDuty && 'Night',
                    caregiver.availability.liveIn24h && '24h live-in',
                  ]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </dd>
              </div>
            </dl>

            {caregiver.skills.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('profile.skills')}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {caregiver.skills.map((s) => (
                    <li key={s.id} className="rounded-full bg-paper px-3 py-1 text-sm text-ink/70">
                      ✓ {s.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {caregiver.relevantExperienceSummary.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('profile.relevantExperience')}</p>
                <ul className="mt-2 list-inside list-disc text-sm text-ink/70">
                  {caregiver.relevantExperienceSummary.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {caregiver.qualificationSummary.length > 0 && (
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('profile.qualifications')}</p>
                <ul className="mt-2 list-inside list-disc text-sm text-ink/70">
                  {caregiver.qualificationSummary.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => setGateOpen(true)}
                className="flex-1 rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                {t('profile.contactCta')}
              </button>
              <button
                type="button"
                onClick={() => setGateOpen(true)}
                className="flex-1 rounded-DEFAULT border border-border px-4 py-2.5 text-sm font-medium text-ink/70 hover:bg-paper"
              >
                {t('profile.saveCta')}
              </button>
            </div>
          </article>
        )}
      </div>

      <RegistrationGate open={gateOpen} onClose={() => setGateOpen(false)} reason="contact" />
    </main>
  );
}
