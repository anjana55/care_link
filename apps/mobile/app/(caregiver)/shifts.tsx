import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { ShiftRow } from '@/ui/ShiftRow';
import { IssueForm, IssueReportList } from '@/care/IssueForm';
import { useMyShiftIssues, useMyShifts, useReportShiftIssue } from '@/caregiver/api';
import { ShiftCarePlan } from '@/caregiver/ShiftCarePlan';

/**
 * The caregiver's confirmed shifts, as on the website - read-only: staff
 * arrange them and any change by phone. Where (by area) and which booking,
 * never the client's name or address. Each shift with a care plan can show
 * it; each that has started (or was cancelled) has "Report a problem"; their
 * reports and our answers are listed underneath.
 */
export default function Shifts() {
  const { t } = useTranslation();
  const colors = useColors();
  const shifts = useMyShifts();
  const issues = useMyShiftIssues();
  const report = useReportShiftIssue();
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const now = Date.now();

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => void shifts.refetch()} />}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('portal.shifts.bookedTitle')}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.shifts.bookedSubtitle')}</Text>

        {shifts.isLoading ? <ActivityIndicator color={colors.brand} /> : null}
        {shifts.isError ? <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text> : null}
        {shifts.isSuccess && !shifts.data.length ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.shifts.noBooked')}</Text> : null}

        <View>
          {(shifts.data ?? []).map((s) => {
            const canReport = new Date(s.startsAt).getTime() <= now || s.status === 'CANCELLED';
            return (
              <ShiftRow key={s.id} shift={s} coverLabel={t('portal.shifts.cover')} extra={[s.bookingReference, s.area].filter(Boolean).join(' · ')}>
                <View style={styles.actions}>
                  {s.hasCarePlan ? (
                    <Button
                      variant="link"
                      label={planFor === s.id ? t('carePlan.hidePlan') : t('carePlan.showPlan')}
                      onPress={() => setPlanFor(planFor === s.id ? null : s.id)}
                    />
                  ) : null}
                  {canReport && reporting !== s.id ? (
                    <Button
                      variant="link"
                      label={t('issues.reportShort')}
                      onPress={() => {
                        setSent(false);
                        setReporting(s.id);
                      }}
                    />
                  ) : null}
                </View>
                {planFor === s.id ? <ShiftCarePlan shiftId={s.id} /> : null}
                {reporting === s.id ? (
                  <IssueForm
                    role="CAREGIVER"
                    pending={report.isPending}
                    error={report.error}
                    onCancel={() => setReporting(null)}
                    onSubmit={(body) =>
                      report.mutate(
                        { ...body, shiftId: s.id },
                        {
                          onSuccess: () => {
                            setReporting(null);
                            setSent(true);
                          },
                        },
                      )
                    }
                  />
                ) : null}
              </ShiftRow>
            );
          })}
        </View>

        {sent ? (
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.brand }}>
            {t('issues.sent')}
          </Text>
        ) : null}
        <IssueReportList reports={issues.data ?? []} showBooking />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
});
