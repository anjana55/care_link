import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { CLIENT_ISSUE_CATEGORIES, MAX_ISSUE_MESSAGE, type ClientBooking, type IssueReportCategory, type MyIssueReport } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { fontFamilyFor } from '@/ui/fonts';
import { Text } from '@/ui/Text';
import { fmtDay, fmtTime } from '@/ui/dates';
import { useReportBookingIssue } from './billing-api';

/**
 * "Something's not right?" on one booking, as on the website: it never
 * changes the record - our team checks it, puts it right or explains, and
 * says so. The reports already sent about this booking are listed with our answer.
 */
export function BookingIssues({ booking, reports }: { booking: ClientBooking; reports: MyIssueReport[] }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const report = useReportBookingIssue(booking.id);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [category, setCategory] = useState<IssueReportCategory | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const valid = Boolean(category) && message.trim().length >= 5;

  const submit = () => {
    if (!valid || report.isPending) return;
    report.mutate(
      { category: category!, message: message.trim(), ...(shiftId ? { shiftId } : {}) },
      {
        onSuccess: () => {
          setOpen(false);
          setSent(true);
          setCategory(null);
          setShiftId(null);
          setMessage('');
        },
      },
    );
  };

  return (
    <View style={[styles.box, { borderColor: colors.border }]}>
      {reports.length ? (
        <View style={{ gap: 8 }}>
          <Text style={[styles.label, { color: colors.muted }]}>{t('issues.yourReports')}</Text>
          {reports.map((r) => (
            <View key={r.id} style={[styles.report, { borderColor: colors.border }]}>
              <View style={styles.row}>
                <Text style={{ flex: 1, fontWeight: '600', color: colors.ink }}>
                  {t(`issues.category.${r.category}`)}
                  <Text style={{ fontWeight: '400', fontSize: 13, color: colors.muted }}>
                    {'  '}
                    {r.shiftStartsAt ? fmtDay(r.shiftStartsAt, locale) : t('issues.wholeBooking')}
                  </Text>
                </Text>
                <Text style={[styles.badge, { color: r.status === 'OPEN' ? colors.ink : colors.brand, borderColor: r.status === 'OPEN' ? colors.border : colors.brand }]}>
                  {t(`issues.status.${r.status}`)}
                </Text>
              </View>
              <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{r.message}</Text>
              {r.resolutionNote ? <Text style={{ fontSize: 14, lineHeight: 20, color: colors.ink }}>{t('issues.ourAnswer', { note: r.resolutionNote })}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {sent && !open ? (
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, color: colors.brand }}>
          {t('issues.sent')}
        </Text>
      ) : null}

      {open ? (
        <View style={{ gap: 14 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('issues.formIntro')}</Text>
          <Chips
            label={t('issues.whatsWrong')}
            choices={CLIENT_ISSUE_CATEGORIES.map((c) => ({ value: c, label: t(`issues.category.${c}`) }))}
            selected={category ? [category] : []}
            onToggle={setCategory}
          />
          {booking.shifts.length ? (
            <SelectField
              label={t('issues.whichShift')}
              choices={booking.shifts.map((s) => ({ value: s.id, label: `${fmtDay(s.startsAt, locale)} · ${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)}` }))}
              value={shiftId}
              onChange={setShiftId}
              none={t('issues.wholeBooking')}
            />
          ) : null}
          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: colors.ink }]}>{t('issues.tellUs')}</Text>
            <TextInput
              accessibilityLabel={t('issues.tellUs')}
              value={message}
              onChangeText={setMessage}
              placeholder={t('issues.placeholderClient')}
              placeholderTextColor={colors.muted}
              maxLength={MAX_ISSUE_MESSAGE}
              multiline
              style={[styles.input, { borderColor: colors.border, color: colors.ink, backgroundColor: colors.surface, fontFamily: fontFamilyFor(locale, false) }]}
            />
          </View>
          {report.isError ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {report.error instanceof ApiError && report.error.message ? report.error.message : t('care.actionError')}
            </Text>
          ) : null}
          <Button label={report.isPending ? t('common.loading') : t('issues.send')} onPress={submit} busy={report.isPending} disabled={!valid} />
          <Button variant="secondary" label={t('issues.cancel')} onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Button
          variant="link"
          label={t('issues.report')}
          onPress={() => {
            setSent(false);
            setOpen(true);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 6, gap: 10 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  report: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlignVertical: 'top' },
});
