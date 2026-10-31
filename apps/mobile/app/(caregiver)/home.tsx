import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { CareChecklistShift } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { ShiftRow } from '@/ui/ShiftRow';
import { useCaregiver, useMyShifts, useOwnCaregiver } from '@/caregiver/api';
import { missingCore } from '@/caregiver/documents';
import { ShiftCarePlan } from '@/caregiver/ShiftCarePlan';
import { remindersFor, useCareReminders } from '@/caregiver/reminders';

/** Shifts shown on Today: the one under way and the next ones. */
const SHOWN = 3;
/** A shift's care plan opens on Today, and its reminders are set, from this long before it starts. */
const AHEAD_MS = 24 * 60 * 60_000;

/**
 * A caregiver's home. Where their registration stands, their next shifts in
 * Sri Lanka time, the documents staff still need, and the care plan for any shift starting within a day -
 * read-only, as decided - with the plan's activity reminders set on the phone.
 */
export default function Today() {
  const { t } = useTranslation();
  const colors = useColors();
  const { user } = useAuth();
  const me = useCaregiver();
  const record = useOwnCaregiver();
  const shifts = useMyShifts();
  const queryClient = useQueryClient();
  const router = useRouter();

  const now = Date.now();
  const upcoming = (shifts.data ?? []).filter((s) => s.status !== 'CANCELLED' && new Date(s.endsAt).getTime() > now).slice(0, SHOWN);
  const soon = upcoming.filter((s) => s.hasCarePlan && new Date(s.startsAt).getTime() - now < AHEAD_MS);

  // The plans of the shifts starting soon: shown below, and the source of the reminders.
  const plans = useQueries({
    queries: soon.map((s) => ({
      queryKey: ['caregiver', me?.userId ?? 'none', 'shift-care', s.id, 'reminders'],
      queryFn: () => api.get<CareChecklistShift>(`/me/shifts/${encodeURIComponent(s.id)}/care`),
      enabled: Boolean(me),
    })),
  });
  const allLoaded = shifts.isSuccess && plans.every((p) => p.isSuccess);
  useCareReminders(
    allLoaded
      ? remindersFor(
          plans.map((p) => p.data!),
          (i) => (i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlan.slot.${i.slot}`) : t('carePlan.anyTime')),
        )
      : null,
  );

  if (!user) return <Redirect href="/" />;
  // A client's area is Find.
  if (user.role !== 'CAREGIVER') return <Redirect href="/find" />;

  const c = record.data;
  // What staff still need: the core documents not uploaded, and any sent back.
  const missing = c ? missingCore(c.documents ?? []) : [];
  const rejected = Boolean(c?.documents?.some((d) => d.verificationStatus === 'REJECTED'));
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['caregiver', me?.userId ?? 'none'] })} />}
      >
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.welcome')}</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {c?.fullName ?? user.phone ?? user.email ?? ''}
          </Text>
          {c ? (
            <>
              <View style={styles.row}>
                <Text style={[styles.badge, { color: colors.brand, borderColor: colors.brand }]}>{t(`portal.status.${c.status}`)}</Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>
                  {t('portal.registrationNumber')} {c.registrationNumber}
                </Text>
              </View>
              <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{t(`portal.statusHelp.${c.status}`)}</Text>
            </>
          ) : record.isError ? (
            <Text style={{ color: colors.danger }}>{t('portal.loadError')}</Text>
          ) : null}
        </View>

        {c && (missing.length || rejected) ? (
          <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
              {t('portal.checklist.documents.title')}
            </Text>
            {rejected ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.danger }}>{t('portal.documents.rejectedHint')}</Text> : null}
            {missing.length ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{t('portal.checklist.documents.hint')}</Text>
                {missing.map((m) => (
                  <Text key={m} style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>
                    {'•  '}
                    {t(`portal.documents.core.${m}`)}
                  </Text>
                ))}
              </View>
            ) : null}
            <Button label={t('portal.documents.add')} onPress={() => router.navigate('/documents')} />
          </View>
        ) : null}

        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
            {t('portal.shifts.bookedTitle')}
          </Text>
          {shifts.isLoading ? <ActivityIndicator color={colors.brand} /> : null}
          {shifts.isError ? <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text> : null}
          {shifts.isSuccess && !upcoming.length ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.shifts.noBooked')}</Text> : null}
          {upcoming.map((s) => (
            <ShiftRow key={s.id} shift={s} coverLabel={t('portal.shifts.cover')} extra={[s.bookingReference, s.area].filter(Boolean).join(' · ')}>
              {soon.includes(s) ? <ShiftCarePlan shiftId={s.id} /> : null}
            </ShiftRow>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 8 },
  title: { fontSize: 24, fontWeight: '700' },
  section: { fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
