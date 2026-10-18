'use client';

import Link from 'next/link';
import { BadgeCheck, MapPin } from 'lucide-react';
import type { PublicCaregiverProfile } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';

/**
 * The one-line anonymous view of a caregiver used in the client's account
 * lists - the same public facts the search results show, nothing more.
 */
export function CaregiverSummary({
  publicId,
  caregiver,
  unavailableText,
}: {
  publicId: string;
  caregiver: PublicCaregiverProfile | null;
  /** Shown instead of the profile when there is none to show. */
  unavailableText?: string;
}) {
  const { t } = useTranslation();
  const label = t('profile.anonymousId', { id: publicId.slice(0, 8) });

  if (!caregiver) {
    return (
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</p>
        <p className="mt-0.5 text-sm text-ink/60">{unavailableText ?? t('account.requests.unavailable')}</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</p>
      <Link href={`/caregivers/${publicId}`} className="mt-0.5 block text-base font-semibold text-ink hover:text-brand-dark hover:underline">
        {caregiver.gender === 'FEMALE' ? '♀' : caregiver.gender === 'MALE' ? '♂' : ''} {t('results.approxAge', { age: caregiver.approxAge })} ·{' '}
        {t('results.yearsExperience', { years: caregiver.yearsExperience })}
      </Link>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink/60">
        <span className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5 text-ink/40" aria-hidden />
          {[caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—'}
        </span>
        {caregiver.hasVerifiedQualification && (
          <span className="flex items-center gap-1 text-brand-dark">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {t('results.verifiedQualification')}
          </span>
        )}
      </p>
    </div>
  );
}
