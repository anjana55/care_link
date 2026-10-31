import { StyleSheet, View } from 'react-native';
import { SEARCH_RADIUS_OPTIONS_KM, type DeviceLocationError, type MapCityPoint, type PublicSearchResponse, type SearchOrigin } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Chips } from '@/ui/choices';
import { Text } from '@/ui/Text';
import { CaregiverMap } from './CaregiverMap';

/** The tap-to-read text of one count on the map, as the website words it. */
export function usePointLabel() {
  const { t } = useTranslation();
  return (p: MapCityPoint) => {
    const place = p.name ?? '';
    // No distance: nothing has been searched yet, so the map shows where caregivers are.
    if (p.distanceKm === null) return p.count === 1 ? t('map.coverageOne', { place }) : t('map.coverageOther', { count: p.count, place });
    return p.count === 1 ? t('map.pointOne', { place, km: p.distanceKm }) : t('map.pointOther', { count: p.count, place, km: p.distanceKm });
  };
}

/**
 * Caregivers near you, on Find: "Use my location", how far to look, how many
 * caregivers are around the search location and where distances are measured
 * from, and the map. Before a search, the map shows where caregivers live.
 */
export function Nearby({
  response,
  coverage,
  radiusKm,
  onRadiusChange,
  onUseMyLocation,
  locating,
  usingDevicePlace,
  locationError,
}: {
  response: PublicSearchResponse | null;
  coverage: MapCityPoint[];
  radiusKm: number;
  onRadiusChange: (km: number) => void;
  onUseMyLocation: () => void;
  locating: boolean;
  /** The city the person's location is in, once they've used it. */
  usingDevicePlace: string | null;
  locationError: DeviceLocationError | null;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const labelFor = usePointLabel();
  const origin: SearchOrigin | null = response?.origin ?? null;
  const radiusChoices = origin && !SEARCH_RADIUS_OPTIONS_KM.includes(origin.radiusKm as never) ? [...SEARCH_RADIUS_OPTIONS_KM, origin.radiusKm].sort((a, b) => a - b) : [...SEARCH_RADIUS_OPTIONS_KM];
  const shownRadius = origin?.radiusKm ?? radiusKm;

  let summary: string | null = null;
  let wider: number | undefined;
  if (response && origin) {
    const place = origin.source === 'device' ? t('map.placeDevice') : (origin.label ?? '');
    const count = response.total;
    summary =
      origin.source === 'district'
        ? count === 1
          ? t('map.summaryDistrictOne', { place })
          : t('map.summaryDistrictOther', { count, place })
        : count === 1
          ? t('map.summaryOne', { radius: origin.radiusKm, place })
          : t('map.summaryOther', { count, radius: origin.radiusKm, place });
    if (count === 0) wider = SEARCH_RADIUS_OPTIONS_KM.find((km) => km > origin.radiusKm);
  }

  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('map.title')}
      </Text>
      <Button variant="secondary" label={locating ? t('map.locating') : `📍 ${t('map.useMyLocation')}`} busy={locating} onPress={onUseMyLocation} />
      {usingDevicePlace ? <Text style={{ fontSize: 14, color: colors.muted }}>{t('map.usingDevice', { place: usingDevicePlace })}</Text> : null}
      {locationError ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, lineHeight: 20, color: colors.danger }}>
          {t(`map.errors.${locationError}`)}
        </Text>
      ) : null}

      {usingDevicePlace || origin ? (
        <Chips
          label={t('map.radius')}
          choices={radiusChoices.map((km) => ({ value: km, label: t('map.radiusOption', { km }) }))}
          selected={[shownRadius]}
          onToggle={onRadiusChange}
        />
      ) : null}

      {summary ? (
        <View accessibilityLiveRegion="polite" style={{ gap: 2 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{summary}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{t(`map.source.${origin!.source}`, { place: origin!.label ?? '' })}</Text>
        </View>
      ) : null}
      {response && origin && response.total === 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 14, color: colors.muted }}>{t('map.noneWithin', { radius: origin.radiusKm })}</Text>
          {wider ? <Button variant="link" label={t('map.widen', { km: wider })} onPress={() => onRadiusChange(wider!)} /> : null}
        </View>
      ) : null}

      <CaregiverMap origin={origin} points={response ? (response.mapPoints ?? []) : coverage} labelFor={labelFor} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
});
