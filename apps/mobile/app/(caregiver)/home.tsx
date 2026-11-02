import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { CareChecklistShift } from '@care-platform/shared';
import { api } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { caregiverOnly } from '@/auth/sides';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Avatar, Card, EmptyState, IconBadge, Pill, tint } from '@/ui/visual';
import { PageHeader } from '@/ui/PageHeader';
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

  const gate = caregiverOnly(user, '/home');
  if (gate) return <Redirect href={gate} />;

  const c = record.data;
  // What staff still need: the core documents not uploaded, and any sent back.
  const missing = c ? missingCore(c.documents ?? []) : [];
  const rejected = Boolean(c?.documents?.some((d) => d.verificationStatus === 'REJECTED'));
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ['caregiver', me?.userId ?? 'none'] })} />}
      >
        <PageHeader isHome>
          <View style={styles.heroRow}>
            <Avatar name={c?.fullName ?? user?.phone ?? user?.email} size={60} onBrand />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 17, color: '#FFFFFF' }}>{t('portal.welcome')}</Text>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.brandText }]}>
                {c?.fullName ?? user?.phone ?? user?.email ?? ''}
              </Text>
              {c ? (
                <Text style={{ fontSize: 15, color: '#FFFFFF' }}>
                  {t('portal.registrationNumber')} {c.registrationNumber}
                </Text>
              ) : null}
            </View>
          </View>
          {c ? (
            <View style={[styles.statusBox, { backgroundColor: colors.surface }]}>
              <Pill icon="ellipse" tone={c.status === 'ACTIVE' ? 'brand' : 'accent'} label={t(`portal.status.${c.status}`)} />
              <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{t(`portal.statusHelp.${c.status}`)}</Text>
            </View>
          ) : record.isError ? (
            <Text style={{ color: colors.brandText }}>{t('portal.loadError')}</Text>
          ) : null}
        </PageHeader>

        {c && (missing.length || rejected) ? (
          <Card style={[styles.card, { borderColor: tint(colors.danger, 0.3) }]}>
            <View style={styles.sectionRow}>
              <IconBadge name="document-attach-outline" tone="danger" />
              <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
                {t('portal.checklist.documents.title')}
              </Text>
            </View>
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
          </Card>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.sectionRow}>
            <IconBadge name="calendar-outline" />
            <Text accessibilityRole="header" style={[styles.section, { color: colors.ink }]}>
              {t('portal.shifts.bookedTitle')}
            </Text>
          </View>
          {shifts.isLoading ? <ActivityIndicator color={colors.brand} /> : null}
          {shifts.isError ? <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text> : null}
          {shifts.isSuccess && !upcoming.length ? <EmptyState icon="sunny-outline" body={t('portal.shifts.noBooked')} /> : null}
          {upcoming.map((s) => (
            <ShiftRow key={s.id} shift={s} coverLabel={t('portal.shifts.cover')} extra={[s.bookingReference, s.area].filter(Boolean).join(' · ')}>
              {soon.includes(s) ? <ShiftCarePlan shiftId={s.id} /> : null}
            </ShiftRow>
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16, paddingBottom: 40 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  statusBox: { borderRadius: 16, padding: 14, gap: 8 },
  card: { marginHorizontal: 20, gap: 10 },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '800' },
  section: { flex: 1, fontSize: 20, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
