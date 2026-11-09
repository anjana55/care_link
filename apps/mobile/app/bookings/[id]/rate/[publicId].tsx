import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/visual';
import { formatDate } from '@/ui/dates';
import { useClient } from '@/care/api';
import { SignInPrompt } from '@/care/SignInPrompt';
import { shortId } from '@/search/ResultCard';
import { useBookingReview, useDeleteReview, useSubmitReview } from '@/reviews/api';
import { ReviewForm } from '@/reviews/ReviewForm';
import { BadgeChip, Stars } from '@/reviews/Stars';

/**
 * Rating one caregiver for one booking - the booked caregiver or a cover.
 * Opened from Bookings, from the "How was your care?" notification, and from
 * the website's rate link (app links).
 */
export default function RateCaregiver() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const client = useClient();
  const { id, publicId } = useLocalSearchParams<{ id?: string; publicId?: string }>();
  const { data, isLoading, isError, error, refetch } = useBookingReview(id ?? null, publicId ?? null);
  const submit = useSubmitReview(id ?? '', publicId ?? '');
  const remove = useDeleteReview(id ?? '', publicId ?? '');
  const [done, setDone] = useState<'saved' | 'deleted' | null>(null);
  const [editing, setEditing] = useState(false);

  if (!client) {
    return (
      <Screen title={t('reviews.form.title')}>
        <SignInPrompt body={t('reviews.form.intro')} returnTo={`/bookings/${id ?? ''}/rate/${publicId ?? ''}`} />
      </Screen>
    );
  }
  if (isLoading) {
    return (
      <Screen title={t('reviews.form.title')}>
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </Screen>
    );
  }
  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <Screen title={t('reviews.form.title')}>
        <View accessibilityRole="alert" style={{ gap: 12, marginTop: 24 }}>
          <Text style={{ color: colors.ink, fontSize: 17 }}>{notFound ? t('reviews.form.notFound') : t('error.title')}</Text>
          {notFound ? (
            <Button variant="secondary" label={t('reviews.form.back')} onPress={() => router.replace('/bookings')} />
          ) : (
            <Button variant="secondary" label={t('error.retry')} onPress={() => refetch()} />
          )}
        </View>
      </Screen>
    );
  }

  const review = done === 'deleted' ? null : data.review;
  const errorText = submit.error instanceof Error ? submit.error.message : remove.error instanceof Error ? remove.error.message : null;
  const showForm = data.canReview && !review?.hidden && (!review || editing);

  const confirmDelete = () =>
    Alert.alert(t('reviews.form.delete'), t('reviews.form.deleteConfirm'), [
      { text: t('reviews.form.keep'), style: 'cancel' },
      { text: t('reviews.form.deleteYes'), style: 'destructive', onPress: () => remove.mutate(undefined, { onSuccess: () => setDone('deleted') }) },
    ]);

  return (
    <Screen title={t('reviews.form.title')} subtitle={t('reviews.form.bookingLabel', { reference: data.bookingReference })}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>{t('reviews.form.intro')}</Text>
        <Card style={{ gap: 4 }}>
          <Button
            variant="link"
            label={t('profile.anonymousId', { id: shortId(data.caregiverPublicId) })}
            onPress={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: data.caregiverPublicId } })}
          />
          {data.isCover ? <Text style={{ color: colors.muted }}>{t('reviews.cover')}</Text> : null}
        </Card>

        {done ? (
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 16, fontWeight: '600', color: colors.brand }}>
            {done === 'saved' ? t('reviews.form.thanks') : t('reviews.form.deleted')}
          </Text>
        ) : null}
        {!data.canReview && !review ? <Text style={{ fontSize: 16, color: colors.ink }}>{t('reviews.form.closedNote')}</Text> : null}
        {review?.hidden ? <Text style={{ fontSize: 16, color: colors.ink }}>{t('reviews.form.hiddenNote')}</Text> : null}

        {review && !editing ? (
          <Card style={{ gap: 10 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{t('reviews.yourRating')}</Text>
            <Stars rating={review.rating} size={28} />
            {review.badges.length ? (
              <View style={styles.wrap}>
                {review.badges.map((b) => (
                  <BadgeChip key={b} badge={b} />
                ))}
              </View>
            ) : null}
            {review.comment ? <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ink }}>{review.comment}</Text> : null}
            {review.comment && review.commentStatus !== 'NONE' ? (
              <Text style={{ fontSize: 14, color: colors.muted }}>{t(`reviews.commentStatus.${review.commentStatus}`, { reason: review.commentRejectReason ?? '' })}</Text>
            ) : null}
            {data.canReview && !review.hidden ? (
              <>
                <Text style={{ fontSize: 14, color: colors.muted }}>{t('reviews.until', { date: formatDate(data.reviewUntil.slice(0, 10), locale) })}</Text>
                <Button variant="secondary" label={t('reviews.edit')} onPress={() => { setEditing(true); setDone(null); }} />
              </>
            ) : null}
            <Button variant="link" label={t('reviews.form.delete')} onPress={confirmDelete} />
            <FormError message={remove.error instanceof Error ? remove.error.message : null} />
          </Card>
        ) : null}

        {showForm ? (
          <ReviewForm
            key={review?.updatedAt ?? 'new'}
            existing={review}
            busy={submit.isPending}
            error={errorText}
            onReport={() => router.navigate('/bookings')}
            onSubmit={(body) =>
              submit.mutate(body, {
                onSuccess: () => {
                  setEditing(false);
                  setDone('saved');
                },
              })
            }
          />
        ) : null}
        {done === 'saved' ? <Button variant="secondary" label={t('reviews.form.back')} onPress={() => router.navigate('/bookings')} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: 20, paddingBottom: 40, gap: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
