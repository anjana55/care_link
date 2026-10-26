'use client';

import { LocateFixed, Loader2 } from 'lucide-react';
import {
  SEARCH_RADIUS_OPTIONS_KM,
  type MapCityPoint,
  type PublicSearchResponse,
  type SearchOrigin,
  type ServiceAreaCity,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import type { DeviceLocationError } from '@/lib/hooks/use-device-location';
import type { CaregiverMapLabels } from '@/components/map/caregiver-map';
import { cn } from '@/lib/utils';

/**
 * "There are people near me": the pieces around the finder's map - what the
 * map's markers say, the line that sums up who is nearby, and the controls
 * that change where "near" is measured from and how far it reaches.
 *
 * They used to be one card with its own map underneath the results. The
 * finder is map-first now (the map fills the screen and the search floats
 * over it), so the controls sit on the map and the summary sits with the
 * results, and each is its own component.
 */

/** Marker, popup and legend text for the finder's map. */
export function useNearbyMapLabels(origin: SearchOrigin | null): CaregiverMapLabels {
  const { t } = useTranslation();
  return {
    map: t('map.mapLabel'),
    origin: origin?.source === 'device' ? t('map.originDevice') : `${t('map.origin')}: ${origin?.label ?? ''}`,
    point: (p: MapCityPoint) => {
      const place = p.name ?? '';
      // No distance means nothing has been searched yet: the map is showing
      // where caregivers are, not how far they are from anyone.
      if (p.distanceKm === null) return p.count === 1 ? t('map.coverageOne', { place }) : t('map.coverageOther', { count: p.count, place });
      const km = p.distanceKm;
      return p.count === 1 ? t('map.pointOne', { place, km }) : t('map.pointOther', { count: p.count, place, km });
    },
    serviceCity: (c: ServiceAreaCity) => t('map.serviceCity', { place: c.name, km: c.distanceKm ?? 0 }),
    failed: t('map.failed'),
    legend: {
      origin: origin?.source === 'device' ? t('map.legendOriginDevice') : t('map.legendOrigin'),
      caregivers: t('map.legendCaregivers'),
      serviceArea: t('map.legendServiceArea'),
    },
  };
}

interface NearbySummaryProps {
  response: PublicSearchResponse;
  onRadiusChange: (radiusKm: number) => void;
  locationError: DeviceLocationError | null;
}

/** How many caregivers are around the search location, where that is measured from, and a wider radius when nobody is. */
export function NearbySummary({ response, onRadiusChange, locationError }: NearbySummaryProps) {
  const { t } = useTranslation();
  const origin = response.origin ?? null;

  if (!origin) {
    return locationError ? <LocationError error={locationError} /> : null;
  }

  const place = origin.source === 'device' ? t('map.placeDevice') : (origin.label ?? '');
  const count = response.total;
  const summary =
    origin.source === 'district'
      ? count === 1
        ? t('map.summaryDistrictOne', { place })
        : t('map.summaryDistrictOther', { count, place })
      : count === 1
        ? t('map.summaryOne', { radius: origin.radiusKm, place })
        : t('map.summaryOther', { count, radius: origin.radiusKm, place });
  const wider = SEARCH_RADIUS_OPTIONS_KM.find((km) => km > origin.radiusKm);

  return (
    <section aria-labelledby="nearby-title">
      <h2 id="nearby-title" className="sr-only">
        {t('map.title')}
      </h2>
      <p className="text-sm font-medium text-ink" aria-live="polite">
        {summary}
      </p>
      <p className="mt-0.5 text-xs text-ink/60">{t(`map.source.${origin.source}`, { place: origin.label ?? '' })}</p>

      {locationError && <LocationError error={locationError} />}

      {count === 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink/70">
          <span>{t('map.noneWithin', { radius: origin.radiusKm })}</span>
          {wider && (
            <button type="button" onClick={() => onRadiusChange(wider)} className="font-medium text-brand underline-offset-2 hover:underline">
              {t('map.widen', { km: wider })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function LocationError({ error }: { error: DeviceLocationError }) {
  const { t } = useTranslation();
  return (
    <p role="alert" className="mt-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
      {t(`map.errors.${error}`)}
    </p>
  );
}

interface NearbyControlsProps {
  origin: SearchOrigin | null;
  onUseMyLocation: () => void;
  locating: boolean;
  /** Left out before there is anything to measure from: no radius to change. */
  onRadiusChange?: (radiusKm: number) => void;
  className?: string;
}

/** "Use my location" and the radius, as floating chips on the map. */
export function NearbyControls({ origin, onUseMyLocation, locating, onRadiusChange, className }: NearbyControlsProps) {
  const { t } = useTranslation();
  const radiusOptions =
    origin && !SEARCH_RADIUS_OPTIONS_KM.includes(origin.radiusKm as (typeof SEARCH_RADIUS_OPTIONS_KM)[number])
      ? [...SEARCH_RADIUS_OPTIONS_KM, origin.radiusKm].sort((a, b) => a - b)
      : [...SEARCH_RADIUS_OPTIONS_KM];
  const chip = 'rounded-full bg-white text-sm font-medium shadow-md ring-1 ring-black/5';

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={onUseMyLocation}
        disabled={locating}
        aria-pressed={origin?.source === 'device'}
        className={cn(chip, 'inline-flex items-center gap-1.5 px-3.5 py-2 text-ink hover:bg-paper disabled:opacity-70', origin?.source === 'device' && 'text-accent-dark')}
      >
        {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4 text-accent" aria-hidden />}
        {locating ? t('map.locating') : t('map.useMyLocation')}
      </button>
      {origin && onRadiusChange && (
        <label className={cn(chip, 'flex items-center gap-1 py-1 pl-3.5 pr-1.5 text-ink/70')}>
          {t('map.radius')}
          <select
            value={origin.radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            className="cursor-pointer rounded-full border-0 bg-transparent py-1 pl-1 pr-6 text-sm font-semibold text-ink focus:ring-2 focus:ring-brand"
          >
            {radiusOptions.map((km) => (
              <option key={km} value={km}>
                {t('map.radiusOption', { km })}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
