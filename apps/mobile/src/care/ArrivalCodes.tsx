import { StyleSheet, View } from 'react-native';
import type { ClientBooking } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { fmtDay, fmtTime } from '@/ui/dates';

/**
 * The code the client reads to the caregiver at the door, as on the website:
 * for each visit about to start or under way with nobody checked in, shown
 * large at the top of Bookings and gone once the caregiver is in. Nothing
 * when check-in is off or no visit is near.
 */
export function ArrivalCodes({ bookings }: { bookings: ClientBooking[] }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const due = bookings
    .flatMap((b) => b.shifts)
    .filter((s) => s.visit?.arrivalCode)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 3);
  if (!due.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {due.map((s) => (
        <View key={s.id} style={[styles.card, { borderColor: colors.brand, backgroundColor: colors.surface }]} testID={`arrival-code-${s.id}`}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('checkIn.client.title')}
          </Text>
          <Text style={{ color: colors.muted }}>{t('checkIn.client.forVisit', { day: fmtDay(s.startsAt, locale), start: fmtTime(s.startsAt), end: fmtTime(s.endsAt) })}</Text>
          <Text accessibilityLabel={s.visit!.arrivalCode!.split('').join(' ')} style={[styles.code, { color: colors.brand }]}>
            {s.visit!.arrivalCode}
          </Text>
          <Text style={{ color: colors.muted }}>{t('checkIn.client.hint')}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 4 },
  title: { fontSize: 17, fontWeight: '700' },
  code: { fontSize: 40, fontWeight: '700', letterSpacing: 10, fontVariant: ['tabular-nums'] },
});
