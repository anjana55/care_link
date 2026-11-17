import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { TALK_CONTACT_METHODS, TALK_MESSAGE_MAX, type TalkAboutType, type TalkContactMethod } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { PageHeader } from '@/ui/PageHeader';
import { Text } from '@/ui/Text';
import { useMyRequests } from '@/care/api';
import { useMyBookings } from '@/care/bookings-api';
import { useMyShifts } from '@/caregiver/api';
import { useAskForAPerson, useMyTalkRequests } from '@/talk/api';

/**
 * "Talk to a person", for clients and caregivers alike: whatever the agents
 * are doing, they can always ask for a member of staff. Naming one of their
 * requests, bookings or shifts hands that case to staff straight away.
 */
export default function TalkScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const isCaregiver = user?.role === 'CAREGIVER';
  const requests = useMyRequests();
  const bookings = useMyBookings();
  const shifts = useMyShifts();
  const mine = useMyTalkRequests();
  const ask = useAskForAPerson();
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState<TalkContactMethod>('CALL');
  const [about, setAbout] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const options = useMemo(() => {
    if (isCaregiver) {
      const now = Date.now();
      return (shifts.data ?? [])
        .filter((s) => s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > now)
        .slice(0, 20)
        .map((s) => ({ value: `SHIFT:${s.id}`, label: t('talk.aboutShift', { ref: s.bookingReference, date: s.startsAt.slice(0, 10) }) }));
    }
    return [
      ...(requests.data ?? []).filter((r) => r.status === 'NEW' || r.status === 'IN_PROGRESS').map((r) => ({ value: `REQUEST:${r.id}`, label: t('talk.aboutRequest', { ref: r.reference }) })),
      ...(bookings.data ?? []).filter((b) => b.status === 'CONFIRMED' || b.status === 'DRAFT').map((b) => ({ value: `BOOKING:${b.id}`, label: t('talk.aboutBooking', { ref: b.reference, date: b.startDate }) })),
    ];
  }, [isCaregiver, shifts.data, requests.data, bookings.data, t]);

  if (!user) return <Redirect href="/" />;
  const error = ask.error instanceof ApiError && ask.error.message ? ask.error.message : ask.error ? t('care.actionError') : null;
  const send = () => {
    const [type, id] = about ? about.split(':') : [];
    ask.mutate(
      { message: message.trim(), contact, ...(type && id ? { about: { type: type as TalkAboutType, id } } : {}) },
      {
        onSuccess: () => {
          setSent(true);
          setMessage('');
          setAbout(null);
        },
      },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PageHeader title={t('talk.title')} subtitle={t('talk.intro')} />
      <ScrollView contentContainerStyle={styles.page}>
        {sent ? (
          <View accessibilityLiveRegion="polite" style={[styles.card, { borderColor: colors.brand }]}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('talk.sentTitle')}</Text>
            <Text style={{ fontSize: 15, color: colors.muted }}>{t('talk.sentBody')}</Text>
            <Button variant="link" label={t('talk.another')} onPress={() => setSent(false)} />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <Field label={t('talk.message')} value={message} onChangeText={setMessage} maxLength={TALK_MESSAGE_MAX} multiline />
            {options.length ? (
              <SelectField label={t('talk.about')} choices={options} value={about} onChange={setAbout} none={t('talk.aboutNone')} />
            ) : null}
            <Chips label={t('talk.contact')} choices={TALK_CONTACT_METHODS.map((m) => ({ value: m, label: t(`talk.contactMethods.${m}`) }))} selected={[contact]} onToggle={setContact} />
            <FormError message={error} />
            <Button label={t('talk.send')} busy={ask.isPending} disabled={message.trim().length < 5} onPress={send} />
          </View>
        )}
        {(mine.data ?? []).length ? (
          <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{t('talk.mine')}</Text>
            {mine.data!.map((r) => (
              <View key={r.id} style={[styles.card, { borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, color: r.status === 'OPEN' ? colors.danger : colors.brand }}>{t(`talk.status.${r.status}`)}</Text>
                <Text style={{ fontSize: 15, color: colors.ink }}>{r.message}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 20 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
});
