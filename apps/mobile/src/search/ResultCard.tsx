import { Pressable, StyleSheet, View } from 'react-native';
import type { PublicCaregiverSummary } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';

/** The short id the website shows for a caregiver ("Caregiver 1a2b3c4d") - no names on public listings. */
export const shortId = (publicId: string) => publicId.slice(0, 8);

/** One search result, as on the website's results list. Tapping it opens the profile. */
export function ResultCard({ caregiver, onOpen }: { caregiver: PublicCaregiverSummary; onOpen: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  // The closest city they travel to, when that - not where they live - is what puts them in range.
  const nearestServiceCity =
    caregiver.reach === 'serviceArea'
      ? [...(caregiver.serviceArea ?? [])].filter((c) => c.distanceKm !== null).sort((a, b) => a.distanceKm! - b.distanceKm!)[0]
      : undefined;
  const sign = caregiver.gender === 'FEMALE' ? '♀ ' : caregiver.gender === 'MALE' ? '♂ ' : '';
  const place = [caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('profile.anonymousId', { id: shortId(caregiver.publicId) })}, ${t('results.viewProfile')}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.top}>
        <Text style={[styles.id, { color: colors.muted }]}>{t('profile.anonymousId', { id: shortId(caregiver.publicId) })}</Text>
        {caregiver.verified ? (
          <Text accessibilityHint={t('results.verifiedHint')} style={[styles.badge, { color: colors.brand, borderColor: colors.brand }]}>
            ✓ {t('results.verified')}
          </Text>
        ) : null}
        {caregiver.matchScore !== undefined ? (
          <Text style={[styles.badge, { color: colors.brand, borderColor: colors.brand }]}>{t('results.recommendedMatch')}</Text>
        ) : null}
      </View>
      <Text style={[styles.headline, { color: colors.ink }]}>
        {sign}
        {t('results.approxAge', { age: caregiver.approxAge })} · {t('results.yearsExperience', { years: caregiver.yearsExperience })}
      </Text>
      <Text style={[styles.line, { color: colors.muted }]}>
        📍 {place}
        {caregiver.distanceKm !== null && caregiver.distanceKm !== undefined ? (
          <Text style={{ color: colors.ink, fontWeight: '600' }}> · {t('map.kmAway', { km: caregiver.distanceKm })}</Text>
        ) : null}
      </Text>
      {nearestServiceCity ? (
        <Text style={[styles.line, { color: colors.ink }]}>{t('map.travelsHere', { place: nearestServiceCity.name, km: nearestServiceCity.distanceKm! })}</Text>
      ) : null}
      {caregiver.languages.length ? <Text style={[styles.line, { color: colors.muted }]}>🗣 {caregiver.languages.map((l) => l.name).join(' · ')}</Text> : null}
      {caregiver.skills.length ? (
        <View style={styles.skills}>
          {caregiver.skills.slice(0, 6).map((s) => (
            <Text key={s.id} style={[styles.skill, { backgroundColor: colors.background, color: colors.ink }]}>
              ✓ {s.name}
            </Text>
          ))}
        </View>
      ) : null}
      {caregiver.hasVerifiedQualification ? (
        <Text style={[styles.line, { color: colors.brand, fontWeight: '600' }]}>{t('results.verifiedQualification')}</Text>
      ) : null}
      {caregiver.aiReason ? (
        <View style={[styles.reason, { borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand }}>{t('results.aiReason')}</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{caregiver.aiReason}</Text>
        </View>
      ) : null}
      {caregiver.matchReasons?.length ? (
        <View style={[styles.reason, { borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>{t('results.whyThisMatches')}</Text>
          {caregiver.matchReasons.map((r, i) => (
            <Text key={i} style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>
              • {r}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={[styles.open, { color: colors.brand }]}>{t('results.viewProfile')} ›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  id: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  headline: { fontSize: 17, fontWeight: '700' },
  line: { fontSize: 15, lineHeight: 22 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  skill: { fontSize: 13, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  reason: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 2, marginTop: 6 },
  open: { fontSize: 16, fontWeight: '700', marginTop: 6 },
});
