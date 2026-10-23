'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, MapPinned, Route, Sparkles } from 'lucide-react';
import { SEARCH_RADIUS_OPTIONS_KM, type MapCityPoint, type ServiceAreaCity, type StaffSuggestionsResponse } from '@care-platform/shared';
import { CaregiverMap, type CaregiverMapLabels } from '@/components/map/caregiver-map';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useRequestSuggestions } from '@/lib/hooks/use-ai';
import { useSetCareRequestCaregiver } from '@/lib/hooks/use-care-requests';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CareRequestDetail } from '@/lib/api/types';

/**
 * "Suggest caregivers" for an open request: active caregivers who fit the
 * client's location, shift and preferences (the same hard filters as the
 * public search), ranked - by the AI when Settings > AI has matching on, which
 * also reads the client's care-needs text and message. Fetched on demand,
 * because each lookup may cost a model call.
 */
/**
 * Where the matching caregivers are relative to the client: a count per city
 * on a map, the search radius, and - for a picked caregiver - the cities they
 * travel to.
 */
function NearbyMap({
  data,
  shown,
  onRadiusChange,
}: {
  data: StaffSuggestionsResponse;
  shown: string | null;
  onRadiusChange: (km: number) => void;
}) {
  const { t, locale } = useTranslation();
  const origin = data.origin;
  const highlightedItem = data.items.find((c) => c.caregiverId === shown) ?? null;
  const highlight = useMemo(
    () => (highlightedItem ? { home: highlightedItem.homeLocation, serviceArea: highlightedItem.serviceArea } : null),
    [highlightedItem],
  );
  if (!origin) return <p className="mb-3 rounded bg-paper px-3 py-2 text-xs text-ink/60">{t('suggestions.map.noLocation')}</p>;

  const labels: CaregiverMapLabels = {
    map: t('suggestions.map.mapLabel'),
    origin: t('suggestions.map.origin', { place: origin.label ?? '' }),
    point: (p: MapCityPoint) =>
      p.count === 1
        ? t('suggestions.map.pointOne', { place: p.name ?? '', km: p.distanceKm ?? 0 })
        : t('suggestions.map.pointOther', { count: p.count, place: p.name ?? '', km: p.distanceKm ?? 0 }),
    serviceCity: (c: ServiceAreaCity) => t('suggestions.map.serviceCity', { place: c.name, km: c.distanceKm ?? 0 }),
    failed: t('suggestions.map.failed'),
    legend: {
      origin: t('suggestions.map.legendOrigin'),
      caregivers: t('suggestions.map.legendCaregivers'),
      serviceArea: t('suggestions.map.legendServiceArea'),
    },
  };
  const count = data.mapPoints.reduce((sum, p) => sum + p.count, 0);
  const place = origin.label ?? '';
  const summary =
    origin.source === 'district'
      ? t(count === 1 ? 'suggestions.map.summaryDistrictOne' : 'suggestions.map.summaryDistrictOther', { count, place })
      : t(count === 1 ? 'suggestions.map.summaryOne' : 'suggestions.map.summaryOther', { count, radius: origin.radiusKm, place });
  const wider = SEARCH_RADIUS_OPTIONS_KM.find((km) => km > origin.radiusKm);

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{summary}</p>
        <label className="flex items-center gap-1.5 text-xs text-ink/70">
          {t('suggestions.map.radius')}
          <select
            value={origin.radiusKm}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
            className="rounded border border-border bg-white px-2 py-1 text-xs text-ink"
          >
            {[...new Set([...SEARCH_RADIUS_OPTIONS_KM, origin.radiusKm])]
              .sort((a, b) => a - b)
              .map((km) => (
                <option key={km} value={km}>
                  {t('suggestions.map.radiusOption', { km })}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="mt-0.5 text-xs text-ink/60">{t(`suggestions.map.source.${origin.source}`, { place })}</p>
      {count === 0 && wider && (
        <p className="mt-2 text-xs text-ink/70">
          {t('suggestions.map.noneWithin', { radius: origin.radiusKm })}{' '}
          <button type="button" onClick={() => onRadiusChange(wider)} className="font-medium text-brand hover:underline">
            {t('suggestions.map.widen', { km: wider })}
          </button>
        </p>
      )}
      <CaregiverMap
        className="relative mt-3 h-64 w-full overflow-hidden rounded-lg border border-border bg-paper sm:h-80"
        origin={origin}
        points={data.mapPoints}
        highlight={highlight}
        labels={labels}
        locale={locale}
      />
    </div>
  );
}

export function CaregiverSuggestions({ request }: { request: CareRequestDetail }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const [radiusKm, setRadiusKm] = useState<number | undefined>(undefined);
  const [shown, setShown] = useState<string | null>(null);
  const { data, isFetching, isError, error, refetch } = useRequestSuggestions(request.id, asked, radiusKm);
  const attach = useSetCareRequestCaregiver(request.id);

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles size={16} className="text-accent" aria-hidden />
          {t('suggestions.title')}
        </CardTitle>
        {asked && !isFetching && (
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            {t('suggestions.refresh')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!asked && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink/60">{t('suggestions.hint')}</p>
            <Button variant="secondary" size="sm" onClick={() => setAsked(true)}>
              {t('suggestions.find')}
            </Button>
          </div>
        )}
        {asked && isFetching && <p className="text-sm text-ink/50">{t('suggestions.loading')}</p>}
        {asked && isError && (
          <p role="alert" className="text-sm text-danger">
            {error instanceof ApiError ? error.message : t('suggestions.failed')}
          </p>
        )}
        {asked && data && !isFetching && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-ink/60">
              <span>{data.aiRanked ? t('suggestions.aiRanked') : t('suggestions.ruleRanked')}</span>
              {data.criteria.map((c) => (
                <span key={c} className="rounded-full bg-paper px-2 py-0.5 text-ink/70">
                  {c}
                </span>
              ))}
            </div>
            {data.notice && <p className="mb-3 rounded bg-accent-light px-3 py-2 text-xs text-accent">{t('suggestions.notice', { reason: data.notice })}</p>}
            <NearbyMap
              data={data}
              shown={shown}
              onRadiusChange={(km) => {
                setShown(null);
                setRadiusKm(km);
              }}
            />
            {data.items.length === 0 ? (
              <p className="text-sm text-ink/60">{t('suggestions.none')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.items.map((c) => {
                  const attached = request.caregiver?.id === c.caregiverId;
                  const shifts = [c.dayDuty && t('suggestions.shift.day'), c.nightDuty && t('suggestions.shift.night'), c.liveIn24h && t('suggestions.shift.liveIn')].filter(Boolean);
                  const nearestServiceCity =
                    c.reach === 'serviceArea'
                      ? c.serviceArea.filter((a) => a.distanceKm !== null).sort((a, b) => a.distanceKm! - b.distanceKm!)[0]
                      : undefined;
                  return (
                    <li key={c.caregiverId} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/caregivers/${c.caregiverId}`} className="font-medium text-ink hover:underline">
                            {c.fullName}
                          </Link>
                          <span className="text-xs tabular-nums text-ink/50">{c.registrationNumber}</span>
                          {c.hasVerifiedQualification && (
                            <span className="inline-flex items-center gap-1 text-xs text-brand-dark">
                              <BadgeCheck size={13} aria-hidden />
                              {t('suggestions.verified')}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-ink/60">
                          {[
                            [c.city, c.district].filter(Boolean).join(', '),
                            c.distanceKm !== null ? t('suggestions.map.kmAway', { km: c.distanceKm }) : null,
                            t('suggestions.years', { years: c.yearsExperience }),
                            shifts.join(' / '),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {nearestServiceCity && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-accent-dark">
                            <Route size={13} aria-hidden />
                            {t('suggestions.map.travelsHere', { place: nearestServiceCity.name, km: nearestServiceCity.distanceKm! })}
                          </p>
                        )}
                        {c.skills.length > 0 && <p className="mt-1 text-xs text-ink/70">{c.skills.slice(0, 6).join(', ')}</p>}
                        {c.aiReason ? (
                          <p className="mt-1 text-sm text-ink">{c.aiReason}</p>
                        ) : (
                          c.reasons.length > 0 && <p className="mt-1 text-xs text-ink/60">{c.reasons.slice(0, 3).join('; ')}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                      {c.homeLocation && data.origin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-pressed={shown === c.caregiverId}
                          onClick={() => setShown(shown === c.caregiverId ? null : c.caregiverId)}
                        >
                          <MapPinned size={14} className="mr-1" aria-hidden />
                          {shown === c.caregiverId ? t('suggestions.map.hideFromMap') : t('suggestions.map.showOnMap')}
                        </Button>
                      )}
                      {request.canChangeCaregiver &&
                        (attached ? (
                          <span className="text-xs font-medium text-brand-dark">{t('suggestions.attached')}</span>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={attach.isPending} onClick={() => attach.mutate(c.caregiverId)}>
                            {request.caregiver ? t('suggestions.swap') : t('suggestions.attach')}
                          </Button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {attach.isError && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {attach.error instanceof ApiError ? attach.error.message : t('requests.detail.saveFailed')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
