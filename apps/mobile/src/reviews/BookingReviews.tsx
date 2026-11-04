import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReviewableCaregiver } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/visual';
import { shortId } from '@/search/ResultCard';
import { usePendingReviews } from './api';
import { STAR, Stars } from './Stars';

/** The rate screen for one caregiver on one booking. */
export const rateRoute = (r: Pick<ReviewableCaregiver, 'bookingId' | 'caregiverPublicId'>) =>
  ({ pathname: '/bookings/[id]/rate/[publicId]', params: { id: r.bookingId, publicId: r.caregiverPublicId } }) as const;

/** On one booking: each caregiver who has worked on it, with the client's rating or a Rate button. */
export function BookingReviews({ reviews }: { reviews: ReviewableCaregiver[] }) {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  if (!reviews.length) return null;
  return (
    <View style={[styles.box, { borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.muted }]}>{t('reviews.yourRating')}</Text>
      {reviews.map((r) => (
        <View key={r.caregiverPublicId} style={{ gap: 6 }}>
          <Text style={{ fontSize: 15, color: colors.ink }}>
            {t('profile.anonymousId', { id: shortId(r.caregiverPublicId) })}
            {r.isCover ? ` · ${t('reviews.cover')}` : ''}
          </Text>
          {r.review ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Stars rating={r.review.rating} size={22} />
              <Button variant="link" label={r.canReview ? t('reviews.edit') : t('reviews.yourRating')} onPress={() => router.push(rateRoute(r))} />
            </View>
          ) : r.canReview ? (
            <Button variant="secondary" icon="star-outline" label={t('reviews.rateCaregiver')} onPress={() => router.push(rateRoute(r))} />
          ) : (
            <Text style={{ fontSize: 14, color: colors.muted }}>{t('reviews.closed')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

/** "How was your care?" above the bookings, while there are caregivers to rate. */
export function PendingReviewsBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { data } = usePendingReviews();
  if (!data?.length) return null;
  return (
    <Card style={{ gap: 10, borderWidth: 2, borderColor: STAR }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="star" size={22} color={STAR} />
        <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
          {t('reviews.bannerTitle')}
        </Text>
      </View>
      <Text style={{ fontSize: 16, color: colors.ink }}>{data.length === 1 ? t('reviews.bannerOne') : t('reviews.bannerMany', { count: data.length })}</Text>
      <Button label={t('reviews.rateNow')} onPress={() => router.push(rateRoute(data[0]))} />
    </Card>
  );
}

const styles = StyleSheet.create({
  box: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4, gap: 10 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
});
