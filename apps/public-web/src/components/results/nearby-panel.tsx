'use client';

import { useMemo } from 'react';
import { LocateFixed, Loader2 } from 'lucide-react';
import {
  SEARCH_RADIUS_OPTIONS_KM,
  type MapCityPoint,
  type PublicCaregiverSummary,
  type PublicSearchResponse,
  type ServiceAreaCity,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import type { DeviceLocationError } from '@/lib/hooks/use-device-location';
import { CaregiverMap, type CaregiverMapLabels } from '@/components/map/caregiver-map';

interface NearbyPanelProps {
  response: PublicSearchResponse;
  /** The caregiver whose home and service area are drawn on the map, if any. */
  highlighted: PublicCaregiverSummary | null;
  onRadiusChange: (radiusKm: number) => void;
  onUseMyLocation: () => void;
  locating: boolean;
  locationError: DeviceLocationError | null;
}

/**
 * "There are people near me": how many caregivers live or work around the
 * search location, on a map, with the controls that change where "near" is
 * measured from and how far it reaches.
 */
export function NearbyPanel({ response, highlighted, onRadiusChange, onUseMyLocation, locating, locationError }: NearbyPanelProps) {
  const { t, locale } = useTranslation();
  const origin = response.origin ?? null;
  const points = useMemo(() => response.mapPoints ?? [], [response.mapPoints]);
  const highlight = useMemo(
    () => (highlighted ? { home: highlighted.homeLocation, serviceArea: highlighted.serviceArea } : null),
    [highlighted],
  );

  const labels: CaregiverMapLabels = {
    map: t('map.mapLabel'),
    origin: origin?.source === 'device' ? t('map.originDevice') : `${t('map.origin')}: ${origin?.label ?? ''}`,
    point: (p: MapCityPoint) => {
      const place = p.name ?? '';
      const km = p.distanceKm ?? 0;
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

  if (!origin) return null;

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
  const radiusOptions = SEARCH_RADIUS_OPTIONS_KM.includes(origin.radiusKm as (typeof SEARCH_RADIUS_OPTIONS_KM)[number])
    ? [...SEARCH_RADIUS_OPTIONS_KM]
    : [...SEARCH_RADIUS_OPTIONS_KM, origin.radiusKm].sort((a, b) => a - b);

  return (
    <section aria-labelledby="nearby-title" className="mb-6 rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="nearby-title" className="text-lg font-semibold text-ink">
          {t('map.title')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onUseMyLocation}
            disabled={locating}
            aria-pressed={origin.source === 'device'}
            className="inline-flex items-center gap-1.5 rounded-DEFAULT border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-light disabled:opacity-60"
          >
            {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            {locating ? t('map.locating') : t('map.useMyLocation')}
          </button>
          <label className="flex items-center gap-1.5 text-sm text-ink/70">
            {t('map.radius')}
            <select
              value={origin.radiusKm}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
              className="rounded-DEFAULT border border-border bg-white px-2 py-1.5 text-sm text-ink"
            >
              {radiusOptions.map((km) => (
                <option key={km} value={km}>
                  {t('map.radiusOption', { km })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <p className="mt-2 text-sm font-medium text-ink" aria-live="polite">
        {summary}
      </p>
      <p className="mt-0.5 text-xs text-ink/60">{t(`map.source.${origin.source}`, { place: origin.label ?? '' })}</p>

      {locationError && (
        <p role="alert" className="mt-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {t(`map.errors.${locationError}`)}
        </p>
      )}

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

      <CaregiverMap className="relative mt-4 h-72 w-full overflow-hidden rounded-lg border border-border bg-paper sm:h-96" origin={origin} points={points} highlight={highlight} labels={labels} locale={locale} />
    </section>
  );
}
