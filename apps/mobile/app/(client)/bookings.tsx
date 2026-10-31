import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ClientBooking, MyIssueReport } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { ShiftRow } from '@/ui/ShiftRow';
import { useClient } from '@/care/api';
import { useMyBookings } from '@/care/bookings-api';
import { SignInPrompt } from '@/care/SignInPrompt';
import { TodaysCare } from '@/care/TodaysCare';
import { BookingIssues } from '@/care/BookingIssues';
import { useMyIssues } from '@/care/billing-api';
import { shortId } from '@/search/ResultCard';

/**
 * The client's bookings, as on the website: today's care checklist first, then
 * each booking with its caregiver, dates, agreed rate and shifts in Sri Lanka
 * time, and "Something's not right?" on each. Pull down to refresh.
 */
export default function Bookings() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const client = useClient();
  const bookings = useMyBookings();
  const issues = useMyIssues();
  const queryClient = useQueryClient();
  // Pulling down refreshes the bookings and the day's checklist together.
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['client-care', client?.userId ?? 'none'] });

  const head = (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('account.bookings.title')}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('account.bookings.subtitle')}</Text>
      {client ? <TodaysCare /> : <SignInPrompt body={t('account.bookings.empty')} />}
    </View>
  );

  const empty = !client ? null : bookings.isLoading ? (
    <ActivityIndicator color={colors.brand} />
  ) : bookings.isError ? (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text>
      <Button variant="secondary" label={t('error.retry')} onPress={() => bookings.refetch()} />
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, lineHeight: 24, color: colors.muted }}>{t('account.bookings.empty')}</Text>
      <Button variant="secondary" label={t('care.viewRequests')} onPress={() => router.navigate('/requests')} />
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={client ? (bookings.data ?? []) : []}
        keyExtractor={(b) => b.id}
        ListHeaderComponent={head}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={client ? <RefreshControl refreshing={bookings.isRefetching} onRefresh={refresh} /> : undefined}
        renderItem={({ item }) => <BookingCard booking={item} reports={(issues.data ?? []).filter((r) => r.bookingId === item.id)} />}
      />
    </SafeAreaView>
  );
}

function BookingCard({ booking: b, reports }: { booking: ClientBooking; reports: MyIssueReport[] }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const live = b.status === 'CONFIRMED';
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.row}>
        {b.caregiver ? (
          <Button
            variant="link"
            label={t('profile.anonymousId', { id: shortId(b.caregiver.publicId) })}
            onPress={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: b.caregiverPublicId } })}
          />
        ) : (
          <Text style={{ flex: 1, fontSize: 14, color: colors.muted }}>{t('account.requests.notOnline')}</Text>
        )}
        <Text style={[styles.badge, { color: live ? colors.brand : colors.muted, borderColor: live ? colors.brand : colors.border }]}>
          {t(`account.bookings.status.${b.status}`)}
        </Text>
      </View>

      <Field label={t('account.bookings.reference')} value={b.reference} />
      <Field label={t('account.bookings.dates')} value={`${formatDate(b.startDate, locale)} – ${formatDate(b.endDate, locale)}`} />
      {b.rateType && b.rateAmount ? (
        <Field
          label={t('account.bookings.rate')}
          value={`LKR ${Number(b.rateAmount).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t(`account.bookings.rateUnit.${b.rateType}`)}`}
        />
      ) : null}

      <Text style={[styles.label, { color: colors.muted, marginTop: 8 }]}>{t('account.bookings.shifts')}</Text>
      {b.shifts.length === 0 ? (
        <Text style={{ color: colors.muted }}>{t('account.bookings.noShifts')}</Text>
      ) : (
        b.shifts.map((s) => <ShiftRow key={s.id} shift={s} coverLabel={t('account.bookings.cover')} />)
      )}
      <BookingIssues booking={b} reports={reports} />
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 1 }}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <Text style={{ fontSize: 16, color: colors.ink }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  head: { gap: 10, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
