'use client';

import Link from 'next/link';
import { GraduationCap, Languages as LanguagesIcon, Plane } from 'lucide-react';
import type { PublicTalentCard } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { apiUrl } from '@/lib/api/client';
import { VerifiedBadge } from '@/components/results/verified-badge';
import { cn } from '@/lib/utils';

/** A shared profile's photo, or the first letter of the name on a coloured disc when there is none. */
export function TalentPhoto({ photoUrl, firstName, className }: { photoUrl: string | null; firstName: string; className?: string }) {
  if (photoUrl) {
    // A plain <img>: the photo is served by the API (its own origin in some
    // deployments), already sized to 640 px, so next/image would add nothing.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={apiUrl(photoUrl)} alt={firstName} className={cn('rounded-full object-cover', className)} loading="lazy" />;
  }
  return (
    <span aria-hidden className={cn('flex items-center justify-center rounded-full bg-brand-light font-bold text-brand-dark', className)}>
      {firstName.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One caregiver in the talent directory on the employer page. */
export function TalentCard({ talent }: { talent: PublicTalentCard }) {
  const { t } = useTranslation();
  const countries = useCountryNames();

  return (
    <Link
      href={`/talent/${talent.slug}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-white p-5 transition-all hover:-translate-y-0.5 hover:border-brand hover:shadow-lg"
    >
      <div className="flex items-center gap-3">
        <TalentPhoto photoUrl={talent.photoUrl} firstName={talent.firstName} className="h-14 w-14 shrink-0 text-xl" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink group-hover:text-brand-dark">{talent.firstName}</p>
          {talent.headline && <p className="line-clamp-2 text-sm text-ink/60">{talent.headline}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {talent.verified && <VerifiedBadge />}
        <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs text-ink/70">{t('results.yearsExperience', { years: talent.yearsExperience })}</span>
      </div>

      {talent.languages.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-ink/70">
          <LanguagesIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" aria-hidden />
          {talent.languages.map((l) => l.name).join(' · ')}
        </p>
      )}
      {talent.completedTraining.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm font-medium text-brand-dark">
          <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {talent.completedTraining.join(' · ')}
        </p>
      )}
      {talent.targetCountries.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-ink/60">
          <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/40" aria-hidden />
          {t('talent.wantsToWorkIn', { countries: talent.targetCountries.map(countries.name).join(', ') })}
        </p>
      )}
    </Link>
  );
}
