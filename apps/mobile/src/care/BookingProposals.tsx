import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CLIENT_REVIEW_NOTE_MAX, type ClientBookingProposal } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate, fmtWeekday } from '@/ui/dates';
import { shortId } from '@/search/ResultCard';
import { useAnswerBookingProposal, useBookingProposals } from './bookings-api';

/**
 * Bookings the office has prepared and asked the client to check, as on the
 * website: who is coming, on which days, at what times, and what it costs.
 * They accept it as it is or say what to change. Nothing is booked until it
 * is confirmed, and the card says so.
 */
export function BookingProposals() {
  const { data } = useBookingProposals();
  if (!data?.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {data.map((p) => (
        <Proposal key={p.id} proposal={p} />
      ))}
    </View>
  );
}

function Proposal({ proposal: p }: { proposal: ClientBookingProposal }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const answer = useAnswerBookingProposal();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  const waiting = p.status === 'ASKED';
  const days = p.daysOfWeek.length === 7 ? t('account.bookingCheck.everyDay') : p.daysOfWeek.map((d) => fmtWeekday(d, locale)).join(', ');
  const overnight = p.shiftEndTime <= p.shiftStartTime;
  const error = answer.error as Error | null;

  return (
    <View style={[styles.card, { borderColor: waiting ? colors.brand : colors.border, backgroundColor: colors.surface }]} testID={`booking-check-${p.id}`}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t(`account.bookingCheck.title.${p.status}`)}
      </Text>
      <Text style={{ color: colors.muted }}>{t(`account.bookingCheck.intro.${p.status}`)}</Text>

      {p.caregiver ? (
        <Button
          variant="link"
          label={t('profile.anonymousId', { id: shortId(p.caregiver.publicId) })}
          onPress={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: p.caregiver!.publicId } })}
        />
      ) : (
        <Text style={{ color: colors.muted }}>{t('account.bookingCheck.caregiverByTeam')}</Text>
      )}
      <Row label={t('account.bookingCheck.days')} value={days} />
      <Row label={t('account.bookingCheck.times')} value={`${p.shiftStartTime} – ${p.shiftEndTime}${overnight ? ` ${t('account.bookingCheck.nextDay')}` : ''}`} />
      <Row label={t('account.bookings.dates')} value={`${formatDate(p.startDate, locale)} – ${formatDate(p.endDate, locale)} (${t('account.bookingCheck.visits', { n: String(p.shiftCount) })})`} />
      {p.rateType && p.rateAmount ? (
        <Row
          label={t('account.bookingCheck.price')}
          value={`LKR ${Number(p.rateAmount).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t(`account.bookings.rateUnit.${p.rateType}`)}`}
        />
      ) : null}
      <Row label={t('account.bookings.reference')} value={p.reference} />
      {p.status === 'CHANGES_REQUESTED' && p.note ? <Row label={t('account.bookingCheck.youAsked')} value={p.note} /> : null}

      {waiting && !changing ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Button label={t('account.bookingCheck.accept')} busy={answer.isPending} onPress={() => answer.mutate({ id: p.id })} />
          <Button variant="secondary" label={t('account.bookingCheck.change')} disabled={answer.isPending} onPress={() => setChanging(true)} />
        </View>
      ) : null}
      {waiting && changing ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <Field
            label={t('account.bookingCheck.changeLabel')}
            placeholder={t('account.bookingCheck.changePlaceholder')}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={CLIENT_REVIEW_NOTE_MAX}
          />
          <Button label={t('account.bookingCheck.send')} busy={answer.isPending} disabled={note.trim().length < 3} onPress={() => answer.mutate({ id: p.id, note: note.trim() })} />
          <Button variant="secondary" label={t('account.bookingCheck.back')} onPress={() => setChanging(false)} />
        </View>
      ) : null}
      {waiting ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('account.bookingCheck.notBookedYet')}</Text> : null}
      <FormError message={error ? error.message || t('account.bookingCheck.failed') : null} />
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.ink }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  title: { fontSize: 17, fontWeight: '700' },
});
