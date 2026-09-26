import Link from 'next/link';
import { BadgeCheck, MapPin, Languages as LanguagesIcon } from 'lucide-react';
import type { PublicCaregiverSummary } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';

export function ResultCard({ caregiver }: { caregiver: PublicCaregiverSummary }) {
  const { t } = useTranslation();

  return (
    <article className="rounded-lg border border-border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/40">{t('profile.anonymousId', { id: caregiver.publicId.slice(0, 8) })}</p>
          <h3 className="mt-0.5 text-base font-semibold text-ink">
            {caregiver.gender === 'FEMALE' ? '♀' : caregiver.gender === 'MALE' ? '♂' : ''} {caregiver.approxAge} years ·{' '}
            {t('results.yearsExperience', { years: caregiver.yearsExperience })}
          </h3>
        </div>
        {caregiver.matchScore !== undefined && (
          <span className="whitespace-nowrap rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
            {t('results.recommendedMatch')}
          </span>
        )}
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-sm text-ink/70">
        <MapPin className="h-4 w-4 text-ink/40" aria-hidden />
        {[caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—'}
      </p>

      {caregiver.languages.length > 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink/70">
          <LanguagesIcon className="h-4 w-4 text-ink/40" aria-hidden />
          {caregiver.languages.map((l) => l.name).join(' · ')}
        </p>
      )}

      {caregiver.skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {caregiver.skills.slice(0, 6).map((s) => (
            <li key={s.id} className="rounded-full bg-paper px-2.5 py-1 text-xs text-ink/70">
              ✓ {s.name}
            </li>
          ))}
        </ul>
      )}

      {caregiver.hasVerifiedQualification && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand-dark">
          <BadgeCheck className="h-4 w-4" aria-hidden />
          {t('results.verifiedQualification')}
        </p>
      )}

      {caregiver.matchReasons && caregiver.matchReasons.length > 0 && (
        <div className="mt-4 rounded-DEFAULT bg-paper p-3">
          <p className="text-xs font-semibold text-ink/60">{t('results.whyThisMatches')}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-ink/70">
            {caregiver.matchReasons.map((reason, i) => (
              <li key={i}>• {reason}</li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={`/caregivers/${caregiver.publicId}`}
        className="mt-4 inline-block rounded-DEFAULT border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-light"
      >
        {t('results.viewProfile')}
      </Link>
    </article>
  );
}
