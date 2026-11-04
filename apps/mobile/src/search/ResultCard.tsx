import { Pressable, StyleSheet, View } from 'react-native';
import type { PublicCaregiverSummary } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { RatingLine } from '@/reviews/Stars';
import { Pill, tint } from '@/ui/visual';
import Ionicons from '@expo/vector-icons/Ionicons';

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
  const place = [caregiver.city, caregiver.district].filter(Boolean).join(', ') || '—';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        t('profile.anonymousId', { id: shortId(caregiver.publicId) }),
        caregiver.rating ? t('reviews.outOfFive', { rating: caregiver.rating.average }) : null,
        t('results.viewProfile'),
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: tint(colors.ink, 0.06), opacity: pressed ? 0.9 : 1 }]}
    >
      <View style={styles.top}>
        <View style={[styles.portrait, { backgroundColor: tint(caregiver.gender === 'MALE' ? colors.brand : colors.accent, 0.14) }]}>
          <Ionicons name={caregiver.gender === 'MALE' ? 'man' : caregiver.gender === 'FEMALE' ? 'woman' : 'person'} size={30} color={caregiver.gender === 'MALE' ? colors.brand : colors.accent} />
          {caregiver.verified ? (
            <View style={[styles.tick, { backgroundColor: colors.brand, borderColor: colors.surface }]}>
              <Ionicons name="checkmark" size={12} color={colors.brandText} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.id, { color: colors.muted }]}>{t('profile.anonymousId', { id: shortId(caregiver.publicId) })}</Text>
          <Text style={[styles.headline, { color: colors.ink }]}>
            {t('results.approxAge', { age: caregiver.approxAge })} · {t('results.yearsExperience', { years: caregiver.yearsExperience })}
          </Text>
          <RatingLine rating={caregiver.rating} showTopBadge />
          <View style={styles.pills}>
            {caregiver.verified ? (
              <View accessibilityHint={t('results.verifiedHint')}>
                <Pill icon="shield-checkmark" label={t('results.verified')} />
              </View>
            ) : null}
            {caregiver.matchScore !== undefined ? <Pill icon="star" tone="accent" label={t('results.recommendedMatch')} /> : null}
          </View>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="location-outline" size={17} color={colors.accent} />
        <Text style={[styles.line, { color: colors.muted, flex: 1 }]}>
          {place}
          {caregiver.distanceKm !== null && caregiver.distanceKm !== undefined ? (
            <Text style={{ color: colors.ink, fontWeight: '600' }}> · {t('map.kmAway', { km: caregiver.distanceKm })}</Text>
          ) : null}
        </Text>
      </View>
      {nearestServiceCity ? (
        <View style={styles.infoRow}>
          <Ionicons name="car-outline" size={17} color={colors.accent} />
          <Text style={[styles.line, { color: colors.ink, flex: 1 }]}>{t('map.travelsHere', { place: nearestServiceCity.name, km: nearestServiceCity.distanceKm! })}</Text>
        </View>
      ) : null}
      {caregiver.languages.length ? (
        <View style={styles.infoRow}>
          <Ionicons name="chatbubbles-outline" size={17} color={colors.accent} />
          <Text style={[styles.line, { color: colors.muted, flex: 1 }]}>{caregiver.languages.map((l) => l.name).join(' · ')}</Text>
        </View>
      ) : null}
      {caregiver.skills.length ? (
        <View style={styles.skills}>
          {caregiver.skills.slice(0, 6).map((s) => (
            <Text key={s.id} style={[styles.skill, { backgroundColor: tint(colors.brand, 0.08), color: colors.ink }]}>
              {s.name}
            </Text>
          ))}
        </View>
      ) : null}
      {caregiver.hasVerifiedQualification ? (
        <View style={styles.infoRow}>
          <Ionicons name="ribbon-outline" size={17} color={colors.brand} />
          <Text style={[styles.line, { color: colors.brand, fontWeight: '600', flex: 1 }]}>{t('results.verifiedQualification')}</Text>
        </View>
      ) : null}
      {caregiver.aiReason ? (
        <View style={[styles.reason, { backgroundColor: tint(colors.accent, 0.07) }]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>{t('results.aiReason')}</Text>
          <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{caregiver.aiReason}</Text>
        </View>
      ) : null}
      {caregiver.matchReasons?.length ? (
        <View style={[styles.reason, { backgroundColor: tint(colors.brand, 0.06) }]}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted }}>{t('results.whyThisMatches')}</Text>
          {caregiver.matchReasons.map((r, i) => (
            <Text key={i} style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>
              • {r}
            </Text>
          ))}
        </View>
      ) : null}
      <View style={[styles.openRow, { borderTopColor: colors.border }]}>
        <Text style={[styles.open, { color: colors.brand }]}>{t('results.viewProfile')}</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.brand} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 4 },
  portrait: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  id: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  headline: { fontSize: 17, fontWeight: '700' },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  line: { fontSize: 15, lineHeight: 22 },
  skills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  skill: { fontSize: 13, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, overflow: 'hidden' },
  reason: { borderRadius: 12, padding: 12, gap: 2, marginTop: 4 },
  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4 },
  open: { fontSize: 16, fontWeight: '700' },
});
