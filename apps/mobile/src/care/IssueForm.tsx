import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import {
  CAREGIVER_ISSUE_CATEGORIES,
  CLIENT_ISSUE_CATEGORIES,
  MAX_ISSUE_MESSAGE,
  type CreateIssueReportBody,
  type IssueReportCategory,
  type MyIssueReport,
  type PortalShift,
} from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Chips, SelectField } from '@/ui/choices';
import { fontFamilyFor } from '@/ui/fonts';
import { Text } from '@/ui/Text';
import { fmtDay, fmtTime } from '@/ui/dates';

/**
 * "Something's not right" - the client's (about a booking) or the caregiver's
 * (about a shift) way to flag a problem, as on the website. It never changes
 * the record: our team checks it and says what they found. The client may
 * point at one of the booking's shifts.
 */
export function IssueForm({
  role,
  shifts,
  onSubmit,
  pending,
  error,
  onCancel,
}: {
  role: 'CLIENT' | 'CAREGIVER';
  /** Client only: the booking's shifts to choose from. */
  shifts?: PortalShift[];
  onSubmit: (body: CreateIssueReportBody) => void;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const [category, setCategory] = useState<IssueReportCategory | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const valid = Boolean(category) && message.trim().length >= 5;
  const categories = role === 'CLIENT' ? CLIENT_ISSUE_CATEGORIES : CAREGIVER_ISSUE_CATEGORIES;

  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('issues.formIntro')}</Text>
      <Chips
        label={t('issues.whatsWrong')}
        choices={categories.map((c) => ({ value: c, label: t(`issues.category.${c}`) }))}
        selected={category ? [category] : []}
        onToggle={setCategory}
      />
      {role === 'CLIENT' && shifts?.length ? (
        <SelectField
          label={t('issues.whichShift')}
          choices={shifts.map((s) => ({ value: s.id, label: `${fmtDay(s.startsAt, locale)} · ${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)}` }))}
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
          placeholder={t(role === 'CLIENT' ? 'issues.placeholderClient' : 'issues.placeholderCaregiver')}
          placeholderTextColor={colors.muted}
          maxLength={MAX_ISSUE_MESSAGE}
          multiline
          style={[styles.input, { borderColor: colors.border, color: colors.ink, backgroundColor: colors.surface, fontFamily: fontFamilyFor(locale, false) }]}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          {error instanceof ApiError && error.message ? error.message : t('care.actionError')}
        </Text>
      ) : null}
      <Button
        label={pending ? t('common.loading') : t('issues.send')}
        busy={pending}
        disabled={!valid}
        onPress={() => valid && !pending && onSubmit({ category: category!, message: message.trim(), ...(shiftId ? { shiftId } : {}) })}
      />
      <Button variant="secondary" label={t('issues.cancel')} onPress={onCancel} />
    </View>
  );
}

/** The person's own reports, with where each stands and our team's answer. */
export function IssueReportList({ reports, showBooking = false }: { reports: MyIssueReport[]; showBooking?: boolean }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  if (!reports.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.muted }]}>{t('issues.yourReports')}</Text>
      {reports.map((r) => (
        <View key={r.id} style={[styles.report, { borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={{ flex: 1, fontWeight: '600', color: colors.ink }}>
              {t(`issues.category.${r.category}`)}
              <Text style={{ fontWeight: '400', fontSize: 13, color: colors.muted }}>
                {'  '}
                {showBooking ? `${r.bookingReference} · ` : ''}
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
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  fieldLabel: { fontSize: 15, fontWeight: '600' },
  report: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlignVertical: 'top' },
});
