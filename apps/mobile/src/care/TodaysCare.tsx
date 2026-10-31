import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { addDays, type CareChecklistItem, type CareChecklistShift } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { fontFamilyFor } from '@/ui/fonts';
import { Text } from '@/ui/Text';
import { fmtDay, fmtTime, formatDate } from '@/ui/dates';
import { useCareDay, useMarkCareItem, useSetCareReminders } from './bookings-api';

/**
 * Today's care, as on the website: the client ticks off what the caregiver
 * did, item by item, from the booking's care plan. Each shift stays open until
 * midnight at the end of the day it ends; anything unmarked then counts as
 * done and the day becomes read-only. Nothing is shown for a client whose
 * bookings have no care plan.
 */
export function TodaysCare() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const [date, setDate] = useState<string | null>(null);
  const { data, isError, refetch } = useCareDay(date);
  const reminders = useSetCareReminders();

  if (isError) {
    return (
      <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.muted }}>{t('carePlan.loadError')}</Text>
        <Button variant="link" label={t('carePlan.retry')} onPress={() => refetch()} />
      </View>
    );
  }
  if (!data?.hasCarePlans) return null;

  const day = data.date;
  const open = data.shifts.filter((s) => s.canMark).flatMap((s) => s.items.filter((i) => i.status === null)).length;

  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.dayRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('carePlan.previousDay')} onPress={() => setDate(addDays(day, -1))} style={styles.arrow}>
          <Text style={{ fontSize: 22, color: colors.brand }}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {day === data.today ? t('carePlan.todayTitle') : t('carePlan.dayTitle', { date: formatDate(day, locale) })}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('carePlan.nextDay')} onPress={() => setDate(addDays(day, 1))} style={styles.arrow}>
          <Text style={{ fontSize: 22, color: colors.brand }}>›</Text>
        </Pressable>
      </View>
      {day !== data.today ? <Button variant="link" label={t('carePlan.today')} onPress={() => setDate(null)} /> : null}
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('carePlan.intro')}</Text>

      {open > 0 ? (
        <Text accessibilityLiveRegion="polite" style={[styles.left, { color: colors.ink, borderColor: colors.brand }]}>
          {t('carePlan.leftToReview', { count: open })}
        </Text>
      ) : null}

      {data.shifts.length === 0 ? <Text style={{ color: colors.muted }}>{t('carePlan.nothingThisDay')}</Text> : null}
      {data.shifts.map((s) => (
        <ShiftChecklist key={s.shiftId} shift={s} date={date} />
      ))}

      <View style={[styles.reminders, { borderColor: colors.border }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, color: colors.ink }}>{t('carePlan.reminders')}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{t('carePlan.remindersHint')}</Text>
        </View>
        <Switch
          accessibilityLabel={t('carePlan.reminders')}
          value={data.reminders}
          disabled={reminders.isPending}
          onValueChange={(on) => reminders.mutate(on)}
          trackColor={{ true: colors.brand }}
        />
      </View>
    </View>
  );
}

function ShiftChecklist({ shift: s, date }: { shift: CareChecklistShift; date: string | null }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  // The last minute before the cut-off names the day it closes ("until midnight, Mon 2 Nov").
  const closesOn = fmtDay(new Date(new Date(s.cutOffAt).getTime() - 60_000).toISOString(), locale);
  return (
    <View style={[styles.shift, { borderColor: colors.border }]}>
      <View style={[styles.shiftHead, { backgroundColor: colors.background }]}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>
          {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          {s.bookingReference}
          {s.isCover ? ` ${t('account.bookings.cover')}` : ''}
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted, width: '100%' }}>
          {s.locked ? t('carePlan.closed') : s.canMark ? t('carePlan.openUntil', { day: closesOn }) : t('carePlan.notStarted')}
        </Text>
      </View>
      {s.planNotes ? <Text style={[styles.notes, { color: colors.ink, borderColor: colors.border }]}>{s.planNotes}</Text> : null}
      {s.items.length === 0 ? (
        <Text style={{ padding: 12, color: colors.muted }}>{t('carePlan.nothingDue')}</Text>
      ) : (
        s.items.map((i) => <ChecklistItem key={`${i.activityId}-${i.dueKey}`} shift={s} item={i} date={date} />)
      )}
    </View>
  );
}

function ChecklistItem({ shift, item: i, date }: { shift: CareChecklistShift; item: CareChecklistItem; date: string | null }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const mark = useMarkCareItem(date);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState(i.reason ?? '');
  const when = i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlan.slot.${i.slot}`) : t('carePlan.anyTime');
  // Not done leaves the reason box open; saving a reason (or marking Done) closes it.
  const send = (status: 'DONE' | 'NOT_DONE', why?: string, close = true) =>
    mark.mutate(
      { shiftId: shift.shiftId, activityId: i.activityId, dueKey: i.dueKey, status, reason: why?.trim() || null },
      { onSuccess: () => close && setReasonOpen(false) },
    );

  const choice = (status: 'DONE' | 'NOT_DONE', label: string, onPress: () => void) => {
    const on = i.status === status;
    const tone = status === 'DONE' ? colors.brand : colors.danger;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${i.title}`}
        accessibilityState={{ selected: on, disabled: mark.isPending }}
        disabled={mark.isPending}
        onPress={onPress}
        style={[styles.choice, { borderColor: on ? tone : colors.border, backgroundColor: on ? tone : colors.surface }]}
      >
        <Text style={{ fontWeight: '600', color: on ? colors.brandText : colors.ink }}>
          {status === 'DONE' ? '✓ ' : '✕ '}
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.item, { borderColor: colors.border }]}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>{when}</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
          {i.title}
          {i.isCritical ? <Text style={{ fontSize: 13, fontWeight: '700', color: colors.danger }}>{`  ⚠ ${t('carePlan.important')}`}</Text> : null}
        </Text>
        {i.instructions ? <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{i.instructions}</Text> : null}
        {i.status === 'NOT_DONE' && i.reason && !reasonOpen ? <Text style={{ fontSize: 14, color: colors.muted }}>“{i.reason}”</Text> : null}
      </View>

      {shift.canMark ? (
        <View style={styles.choices}>
          {choice('DONE', t('carePlan.done'), () => send('DONE'))}
          {choice('NOT_DONE', t('carePlan.notDone'), () => {
            setReasonOpen(true);
            if (i.status !== 'NOT_DONE') send('NOT_DONE', undefined, false);
          })}
        </View>
      ) : (
        <Outcome item={i} />
      )}

      {shift.canMark && reasonOpen && i.status === 'NOT_DONE' ? (
        <View style={styles.reason}>
          <TextInput
            accessibilityLabel={t('carePlan.reasonPlaceholder')}
            placeholder={t('carePlan.reasonPlaceholder')}
            placeholderTextColor={colors.muted}
            maxLength={300}
            value={reason}
            onChangeText={setReason}
            style={[styles.input, { borderColor: colors.border, color: colors.ink, backgroundColor: colors.surface, fontFamily: fontFamilyFor(locale, false) }]}
          />
          <Button label={t('carePlan.saveReason')} busy={mark.isPending} onPress={() => send('NOT_DONE', reason)} />
        </View>
      ) : null}

      {mark.isError ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, color: colors.danger }}>
          {mark.error instanceof ApiError && mark.error.message ? mark.error.message : t('care.actionError')}
        </Text>
      ) : null}
    </View>
  );
}

function Outcome({ item: i }: { item: CareChecklistItem }) {
  const { t } = useTranslation();
  const colors = useColors();
  const key = !i.status ? 'open' : i.status === 'NOT_DONE' ? 'notDone' : i.source === 'AUTO' ? 'auto' : i.source === 'STAFF' ? 'staff' : 'done';
  const tone = key === 'notDone' ? colors.danger : key === 'open' || key === 'auto' ? colors.muted : colors.brand;
  return <Text style={[styles.outcome, { color: tone, borderColor: tone }]}>{t(`carePlan.outcome.${key}`)}</Text>;
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 12, marginBottom: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 19, fontWeight: '700', textAlign: 'center' },
  left: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 4, fontSize: 15, fontWeight: '600' },
  shift: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  shiftHead: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10, alignItems: 'center' },
  notes: { padding: 10, fontSize: 15, lineHeight: 22, borderTopWidth: StyleSheet.hairlineWidth },
  item: { padding: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  choices: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reason: { gap: 8 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  outcome: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  reminders: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
});
