import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { CARE_OFFER_DECLINE_REASONS, type CareOfferDeclineReason, type CaregiverCareOffer } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, FormError, Screen } from '@/ui/controls';
import { Chips } from '@/ui/choices';
import { Text } from '@/ui/Text';
import { fmtDay, fmtTime, formatDate } from '@/ui/dates';
import { Card, EmptyState, Pill } from '@/ui/visual';
import { useAnswerCareOffer, useCareOffers } from '@/caregiver/api';
import { useMarkPathsRead } from '@/notifications/api';

const money = (n: number) => n.toLocaleString('en-LK');
const TONES = { OFFERED: 'accent', ACCEPTED: 'brand', DECLINED: 'muted', EXPIRED: 'muted', WITHDRAWN: 'muted' } as const;

/**
 * The caregiver's job offers (the website's /caregiver/care-offers). Each
 * waiting offer says what the job is - kind of care, area, start, pay - until
 * when they can answer, and has two large buttons. Nothing here identifies
 * the client: that comes with the booking.
 */
export default function Offers() {
  useMarkPathsRead(['/care-offers']);
  const { t, locale } = useTranslation();
  const colors = useColors();
  const offers = useCareOffers();
  const answer = useAnswerCareOffer();
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState<CareOfferDeclineReason | null>(null);
  const [error, setError] = useState<{ offerId: string; text: string } | null>(null);

  const fail = (offerId: string) => (err: unknown) => setError({ offerId, text: err instanceof ApiError && err.message ? err.message : t('portal.offers.error') });
  const waiting = offers.data?.filter((o) => o.status === 'OFFERED') ?? [];
  const earlier = offers.data?.filter((o) => o.status !== 'OFFERED') ?? [];

  const fact = (label: string, value: string) => (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>{value}</Text>
    </View>
  );

  const card = (o: CaregiverCareOffer) => (
    <Card key={o.id} style={styles.card}>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ fontSize: 19, fontWeight: '700', color: colors.ink }}>
          {o.careType ? t(`careTypes.${o.careType}`) : t('portal.offers.title')}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.offers.reference', { reference: o.reference })}</Text>
        <View style={{ flexDirection: 'row' }}>
          <Pill tone={TONES[o.status]} label={t(`portal.offers.statuses.${o.status}`)} />
        </View>
      </View>
      {fact(t('portal.offers.where'), [o.city?.[locale], o.district?.[locale]].filter(Boolean).join(', ') || '—')}
      {fact(t('portal.offers.starts'), o.desiredStartDate ? formatDate(o.desiredStartDate, locale) : t('portal.offers.startsOpen'))}
      {fact(
        t('portal.offers.rate'),
        o.payRate !== null && o.rateType ? t('portal.offers.rateValue', { amount: money(o.payRate), unit: t(`portal.offers.units.${o.rateType}`) }) : t('portal.offers.rateOpen'),
      )}
      {o.note ? (
        <View style={[styles.note, { backgroundColor: colors.background }]}>
          <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.offers.note')}</Text>
          <Text style={{ fontSize: 16, lineHeight: 23, color: colors.ink }}>{o.note}</Text>
        </View>
      ) : null}
      {o.status === 'ACCEPTED' ? <Text style={{ fontSize: 16, lineHeight: 23, color: colors.brand }}>{t('portal.offers.accepted')}</Text> : null}
      {o.status === 'OFFERED' ? (
        <>
          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.accent }}>
              {t('portal.offers.answerBy', { when: `${fmtDay(o.expiresAt, locale)}, ${fmtTime(o.expiresAt)}` })}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('portal.offers.privacy')}</Text>
          </View>
          <FormError message={error?.offerId === o.id ? error.text : null} />
          {declining === o.id ? (
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('portal.offers.declineHint')}</Text>
              <Chips
                label={t('portal.offers.declineTitle')}
                choices={CARE_OFFER_DECLINE_REASONS.map((r) => ({ value: r, label: t(`portal.offers.reasons.${r}`) }))}
                selected={reason ? [reason] : []}
                onToggle={(r) => setReason(reason === r ? null : r)}
              />
              <Button
                label={t('portal.offers.confirmDecline')}
                busy={answer.isPending}
                onPress={() =>
                  answer.mutate({ offerId: o.id, accept: false, reason: reason ?? undefined }, { onSuccess: () => (setDeclining(null), setReason(null), setError(null)), onError: fail(o.id) })
                }
              />
              <Button variant="secondary" label={t('portal.offers.back')} onPress={() => (setDeclining(null), setReason(null))} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Button
                icon="checkmark-circle-outline"
                label={t('portal.offers.accept')}
                busy={answer.isPending && answer.variables?.offerId === o.id}
                disabled={answer.isPending}
                onPress={() => (setError(null), answer.mutate({ offerId: o.id, accept: true }, { onError: fail(o.id) }))}
              />
              <Button variant="secondary" label={t('portal.offers.decline')} disabled={answer.isPending} onPress={() => (setError(null), setDeclining(o.id))} />
            </View>
          )}
        </>
      ) : null}
    </Card>
  );

  return (
    <Screen title={t('portal.offers.title')} subtitle={t('portal.offers.subtitle')}>
      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()} />}>
        {offers.isError ? <FormError message={t('portal.loadError')} /> : null}
        {offers.data && offers.data.length === 0 ? <EmptyState icon="briefcase-outline" body={t('portal.offers.none')} /> : null}
        {waiting.length ? (
          <View style={styles.group}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
              {t('portal.offers.waiting')}
            </Text>
            {waiting.map(card)}
          </View>
        ) : null}
        {earlier.length ? (
          <View style={styles.group}>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
              {t('portal.offers.earlier')}
            </Text>
            {earlier.map(card)}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 20, paddingBottom: 40, gap: 22 },
  group: { gap: 12 },
  heading: { fontSize: 16, fontWeight: '700' },
  card: { gap: 14 },
  note: { borderRadius: 10, padding: 12, gap: 2 },
});
