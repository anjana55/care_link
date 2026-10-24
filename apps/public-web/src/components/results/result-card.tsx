import Link from 'next/link';
import { BadgeCheck, CheckCircle2, MapPin, MapPinned, Languages as LanguagesIcon, Route } from 'lucide-react';
import type { CaregiverRelation, PublicCaregiverSummary } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { DeviceSaveButton, SaveButton } from '@/components/care/caregiver-actions';
import { VerifiedBadge } from './verified-badge';

/**
 * `relation` is passed only for a signed-in client, and switches on the Save
 * heart and the "request sent" marker. `deviceSave` is for a visitor who is not
 * signed in: the heart keeps the caregiver on this device instead. A signed-in
 * caregiver gets neither.
 */
export function ResultCard({
  caregiver,
  relation,
  deviceSave = false,
  onShowOnMap,
  shownOnMap = false,
}: {
  caregiver: PublicCaregiverSummary;
  relation?: CaregiverRelation;
  deviceSave?: boolean;
  /** Draws this caregiver's home and service area on the results map (toggles). */
  onShowOnMap?: () => void;
  shownOnMap?: boolean;
}) {
  const { t } = useTranslation();
  // The closest city they travel to, when that - not where they live - is what puts them in range.
  const nearestServiceCity =
    caregiver.reach === 'serviceArea'
      ? [...(caregiver.serviceArea ?? [])].filter((c) => c.distanceKm !== null).sort((a, b) => a.distanceKm! - b.distanceKm!)[0]
      : undefined;

  return (
    <article
      className={`rounded-lg border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${shownOnMap ? 'border-accent ring-1 ring-accent' : 'border-border'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/40">{t('profile.anonymousId', { id: caregiver.publicId.slice(0, 8) })}</p>
            {caregiver.verified && <VerifiedBadge />}
          </div>
          <h3 className="mt-0.5 text-base font-semibold text-ink">
            {caregiver.gender === 'FEMALE' ? '♀' : caregiver.gender === 'MALE' ? '♂' : ''}{' '}
            {t('results.approxAge', { age: caregiver.approxAge })} ·{' '}
            {t('results.yearsExperience', { years: caregiver.yearsExperience })}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {caregiver.matchScore !== undefined && (
            <span className="whitespace-nowrap rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
              {t('results.recommendedMatch')}
            </span>
          )}
          {relation && (
            <SaveButton publicId={caregiver.publicId} saved={relation.saved} caregiverLabel={caregiver.publicId.slice(0, 8)} variant="compact" />
          )}
          {!relation && deviceSave && <DeviceSaveButton publicId={caregiver.publicId} caregiverLabel={caregiver.publicId.slice(0, 8)} variant="compact" />}
        </div>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-ink/70">
        <MapPin className="h-4 w-4 text-ink/40" aria-hidden />
        {[caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—'}
        {caregiver.distanceKm !== null && caregiver.distanceKm !== undefined && (
          <span className="font-medium text-ink">· {t('map.kmAway', { km: caregiver.distanceKm })}</span>
        )}
      </p>
      {nearestServiceCity && (
        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-accent-dark">
          <Route className="h-4 w-4" aria-hidden />
          {t('map.travelsHere', { place: nearestServiceCity.name, km: nearestServiceCity.distanceKm! })}
        </p>
      )}

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

      {caregiver.aiReason && (
        <p className="mt-4 rounded-DEFAULT border border-accent/30 bg-accent/5 p-3 text-sm text-ink/80">
          <span className="block text-xs font-semibold text-accent">{t('results.aiReason')}</span>
          {caregiver.aiReason}
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/caregivers/${caregiver.publicId}`}
          className="inline-block rounded-DEFAULT border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-light"
        >
          {t('results.viewProfile')}
        </Link>
        {onShowOnMap && caregiver.homeLocation && (
          <button
            type="button"
            onClick={onShowOnMap}
            aria-pressed={shownOnMap}
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <MapPinned className="h-4 w-4" aria-hidden />
            {shownOnMap ? t('map.hideFromMap') : t('map.showOnMap')}
          </button>
        )}
        {relation?.openRequest && (
          <Link href="/account/requests" className="flex items-center gap-1.5 text-sm font-medium text-brand-dark hover:underline">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t('care.requestSent', { reference: relation.openRequest.reference })}
          </Link>
        )}
      </div>
    </article>
  );
}
