import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CaregiverRatingSummary, ReviewBadge } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { tint } from '@/ui/visual';

/** The star colour: a warm amber that reads as "rating" in every brand palette. */
export const STAR = '#E3A008';

/** Read-only stars, rounded to the nearest whole for the picture; the screen reader hears the exact value. */
export function Stars({ rating, size = 18 }: { rating: number; size?: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  const filled = Math.round(rating);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('reviews.outOfFive', { rating })} style={styles.row}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= filled ? 'star' : 'star-outline'} size={size} color={i <= filled ? STAR : colors.border} />
      ))}
    </View>
  );
}

/**
 * Choosing 1-5 stars: five big targets (56pt), each announced as "4 stars",
 * with the word for the choice ("Good") underneath - many people using the
 * app are older or new to phones.
 */
export function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={{ gap: 4 }}>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('reviews.form.starsQuestion')} style={styles.row}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable
            key={i}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === i }}
            accessibilityLabel={i === 1 ? t('reviews.starOne') : t('reviews.starMany', { count: i })}
            onPress={() => onChange(i)}
            hitSlop={4}
            style={styles.pick}
          >
            <Ionicons name={i <= value ? 'star' : 'star-outline'} size={44} color={i <= value ? STAR : colors.muted} />
          </Pressable>
        ))}
      </View>
      <Text accessibilityLiveRegion="polite" style={{ minHeight: 24, fontSize: 17, fontWeight: '600', color: colors.ink }}>
        {value ? t(`reviews.form.starHint.${value}`) : ''}
      </Text>
    </View>
  );
}

/** "★ 4.8 · 12 ratings" on result cards and profiles. Nothing when there is no rating to show. */
export function RatingLine({ rating, showTopBadge = false }: { rating: CaregiverRatingSummary | null | undefined; showTopBadge?: boolean }) {
  const { t } = useTranslation();
  const colors = useColors();
  if (!rating) return null;
  const top = rating.topBadges[0];
  const count = rating.count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count: rating.count });
  return (
    <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
      <View accessible accessibilityLabel={`${t('reviews.outOfFive', { rating: rating.average })}, ${count}`} style={[styles.row, { gap: 4 }]}>
        <Ionicons name="star" size={16} color={STAR} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{rating.average.toFixed(1)}</Text>
        <Text style={{ fontSize: 14, color: colors.muted }}>· {count}</Text>
      </View>
      {showTopBadge && top ? <BadgeChip badge={top.badge} /> : null}
    </View>
  );
}

export function BadgeChip({ badge, count }: { badge: ReviewBadge; count?: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.chip, { backgroundColor: tint(colors.accent, 0.14) }]}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
        {t(`reviews.badge.${badge}`)}
        {count && count > 1 ? `  × ${count}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  pick: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
});
