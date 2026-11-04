import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { BadgeCount, Locale, PublicReview } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/visual';
import { useMyRatings, usePublicReviews } from './api';
import { BadgeChip, Stars } from './Stars';

const INTL: Record<Locale, string> = { en: 'en-LK', si: 'si-LK', ta: 'ta-LK' };

/** "October 2026", in the reader's language. */
export function reviewMonth(month: string, locale: Locale) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(INTL[locale], { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function BadgeCounts({ counts, title }: { counts: BadgeCount[]; title: string }) {
  const colors = useColors();
  if (!counts.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.muted }]}>{title}</Text>
      <View style={styles.wrap}>
        {counts.map((b) => (
          <BadgeChip key={b.badge} badge={b.badge} count={b.count} />
        ))}
      </View>
    </View>
  );
}

/** One review: stars, badges, text, "Client · Kandy", month. Never a name. */
function ReviewItem({ review }: { review: PublicReview }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.item, { borderColor: colors.border }]}>
      <View style={[styles.wrap, { justifyContent: 'space-between' }]}>
        <Stars rating={review.rating} />
        <Text style={{ fontSize: 13, color: colors.muted }}>{reviewMonth(review.month, locale)}</Text>
      </View>
      {review.badges.length ? (
        <View style={styles.wrap}>
          {review.badges.map((b) => (
            <BadgeChip key={b} badge={b} />
          ))}
        </View>
      ) : null}
      {review.comment ? (
        <Text lang={review.commentLanguage ?? undefined} style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>
          {review.comment}
        </Text>
      ) : null}
      <Text style={{ fontSize: 13, color: colors.muted }}>
        {review.reviewerDistrict ? t('reviews.profile.reviewer', { district: review.reviewerDistrict }) : t('reviews.profile.reviewerNoDistrict')}
      </Text>
    </View>
  );
}

function Summary({ average, count }: { average: number; count: number }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View style={[styles.wrap, { gap: 12 }]}>
      <Text importantForAccessibility="no" style={{ fontSize: 40, fontWeight: '800', color: colors.ink }}>
        {average.toFixed(1)}
      </Text>
      <View style={{ gap: 2 }}>
        <Stars rating={average} size={22} />
        <Text style={{ fontSize: 14, color: colors.muted }}>{count === 1 ? t('reviews.ratingsOne') : t('reviews.ratingsMany', { count })}</Text>
      </View>
    </View>
  );
}

/** Ratings on a public profile. Nothing until the caregiver has enough ratings to show. */
export function CaregiverReviews({ publicId }: { publicId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = usePublicReviews(publicId);
  const first = data?.pages[0];
  if (!first?.summary) return null;
  const items = data!.pages.flatMap((p) => p.items);
  return (
    <Card style={{ gap: 14, marginTop: 16 }}>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>
        {t('reviews.profile.title')}
      </Text>
      <Summary average={first.summary.average} count={first.summary.count} />
      <Text style={{ fontSize: 14, color: colors.muted }}>{t('reviews.profile.basedOn')}</Text>
      <BadgeCounts counts={first.badgeCounts} title={t('reviews.profile.badges')} />
      {items.length === 0 ? (
        <Text style={{ color: colors.muted }}>{t('reviews.profile.noWritten')}</Text>
      ) : (
        items.map((r) => <ReviewItem key={r.id} review={r} />)
      )}
      {hasNextPage ? <Button variant="secondary" label={t('reviews.profile.more')} busy={isFetchingNextPage} onPress={() => fetchNextPage()} /> : null}
    </Card>
  );
}

/** A caregiver's own ratings: their average (even before it's public), badges and approved reviews. */
export function MyRatings() {
  const { t } = useTranslation();
  const colors = useColors();
  const { data, isLoading, isError, refetch } = useMyRatings();
  if (isLoading) return <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />;
  if (isError || !data) {
    return (
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.danger }}>{t('error.title')}</Text>
        <Button variant="secondary" label={t('error.retry')} onPress={() => refetch()} />
      </View>
    );
  }
  if (!data.summary) return <Text style={{ fontSize: 16, color: colors.muted }}>{t('reviews.caregiver.none')}</Text>;
  return (
    <View style={{ gap: 18 }}>
      <Card style={{ gap: 10 }}>
        <Summary average={data.summary.average} count={data.summary.count} />
        <Text style={{ fontSize: 15, color: colors.ink }}>
          {data.shownPublicly ? t('reviews.caregiver.shown') : t('reviews.caregiver.notShownYet', { min: data.minRatingsToShow })}
        </Text>
      </Card>
      <BadgeCounts counts={data.badgeCounts} title={t('reviews.caregiver.badges')} />
      <View style={{ gap: 8 }}>
        <Text style={[styles.label, { color: colors.muted }]}>{t('reviews.caregiver.reviews')}</Text>
        {data.reviews.length ? data.reviews.map((r) => <ReviewItem key={r.id} review={r} />) : <Text style={{ color: colors.muted }}>{t('reviews.caregiver.noReviews')}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 6 },
});
