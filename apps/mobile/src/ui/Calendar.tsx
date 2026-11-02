import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { PageHeader } from './PageHeader';
import { Text } from './Text';
import { tint } from './visual';

/**
 * A month calendar for choosing a day, drawn in plain views - no native date
 * picker, so it looks and reads the same on every phone and in every
 * language. Days are YYYY-MM-DD strings (no time zone can move them); weeks
 * start on Monday, as in Sri Lanka. Days before `min` or after `max` can't be
 * chosen. A range longer than a year adds a year switcher, for dates such as a
 * passport's expiry.
 */

const intlLocale = (locale: string) => (locale === 'en' ? 'en-GB' : locale);
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The first of the month a day is in, as YYYY-MM-01. */
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
function addMonths(month: string, n: number): string {
  const d = utc(month);
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return iso(d);
}
const clamp = (day: string, min?: string, max?: string) => (min && day < min ? min : max && day > max ? max : day);

/** A day in full, for the screen reader and the chosen-day line: "Thursday 12 November 2026". */
export function longDay(day: string, locale: string): string {
  return utc(day).toLocaleDateString(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The days of a month's weeks, Monday first: null for the gaps before the 1st and after the last day. */
export function monthGrid(month: string): (string | null)[] {
  const first = utc(month);
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let n = 1; n <= days; n++) cells.push(`${month.slice(0, 8)}${String(n).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function Calendar({
  value,
  onChange,
  today,
  min,
  max,
}: {
  value: string | null;
  onChange: (day: string) => void;
  /** Today in Sri Lanka, marked with a ring. */
  today: string;
  min?: string;
  max?: string;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const [month, setMonth] = useState(() => monthOf(value ?? clamp(today, min, max)));
  const cells = useMemo(() => monthGrid(month), [month]);
  const canPrev = !min || addMonths(month, -1) >= monthOf(min);
  const canNext = !max || addMonths(month, 1) <= monthOf(max);
  const longRange = Boolean(min && max && utc(max).getTime() - utc(min).getTime() > 400 * 86_400_000);
  const year = Number(month.slice(0, 4));
  const goYear = (n: number) => setMonth(monthOf(clamp(addMonths(month, n * 12), min && monthOf(min), max)));

  const title = utc(month).toLocaleDateString(intlLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // 1 Jan 2024 was a Monday: the week's day names in the reader's language.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' }),
  );

  const arrow = (dir: -1 | 1, enabled: boolean, label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.arrow, { borderColor: colors.border, opacity: enabled ? 1 : 0.35 }]}
    >
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={26} color={colors.deep} />
    </Pressable>
  );

  return (
    <View style={styles.box}>
      {longRange ? (
        <View style={styles.head}>
          {arrow(-1, !min || year > Number(min.slice(0, 4)), t('calendar.previousYear'), () => goYear(-1))}
          <Text style={[styles.year, { color: colors.ink }]}>{year}</Text>
          {arrow(1, !max || year < Number(max.slice(0, 4)), t('calendar.nextYear'), () => goYear(1))}
        </View>
      ) : null}
      <View style={styles.head}>
        {arrow(-1, canPrev, t('calendar.previousMonth'), () => setMonth(addMonths(month, -1)))}
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.month, { color: colors.deep }]}>
          {title}
        </Text>
        {arrow(1, canNext, t('calendar.nextMonth'), () => setMonth(addMonths(month, 1)))}
      </View>

      <View style={styles.week} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {weekdays.map((w) => (
          <Text key={w} style={[styles.weekday, { color: colors.muted }]}>
            {w}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`gap-${i}`} style={styles.cell} />;
          const off = Boolean((min && day < min) || (max && day > max));
          const chosen = day === value;
          const isToday = day === today;
          return (
            <View key={day} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isToday ? `${longDay(day, locale)}, ${t('calendar.today')}` : longDay(day, locale)}
                accessibilityState={{ selected: chosen, disabled: off }}
                disabled={off}
                onPress={() => onChange(day)}
                style={[
                  styles.day,
                  chosen
                    ? { backgroundColor: colors.deep }
                    : off
                      ? null
                      : { backgroundColor: tint(colors.brand, 0.1) },
                  isToday && !chosen ? { borderWidth: 2, borderColor: colors.brand } : null,
                ]}
              >
                <Text style={[styles.dayText, { color: chosen ? colors.brandText : off ? '#8A97A0' : colors.deep }, off ? { fontWeight: '400' } : null]}>
                  {String(Number(day.slice(8)))}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * A date to fill in: the chosen day written out in full, with a calendar
 * picture; tapping it opens the calendar on a full screen, with the chosen
 * day and a big "Choose this date" button underneath. `none` lets the person
 * leave it empty ("Not set"), with a button to clear it.
 */
export function DateField({
  label,
  value,
  onChange,
  today,
  min,
  max,
  none,
  hint,
  error,
}: {
  label: string;
  value: string | null;
  onChange: (day: string | null) => void;
  today: string;
  min?: string;
  max?: string;
  none?: string;
  hint?: string;
  error?: string | null;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(value);
  const show = () => {
    setDraft(value);
    setOpen(true);
  };
  const shown = value ? longDay(value, locale) : (none ?? t('calendar.choose'));

  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown }}
        accessibilityHint={t('calendar.openHint')}
        onPress={show}
        style={[styles.field, { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface }]}
      >
        <View style={[styles.fieldIcon, { backgroundColor: tint(colors.brand, 0.12) }]}>
          <Ionicons name="calendar" size={24} color={colors.brand} />
        </View>
        <Text style={[styles.fieldText, { color: value ? colors.ink : colors.muted }]}>{shown}</Text>
        <Ionicons name="chevron-forward" size={22} color={colors.muted} />
      </Pressable>
      {hint && !error ? <Text style={{ fontSize: 15, lineHeight: 21, color: colors.muted }}>{hint}</Text> : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 15, color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <PageHeader title={label} onBack={() => setOpen(false)} />
          <ScrollView contentContainerStyle={styles.sheet}>
            <Calendar value={draft} onChange={setDraft} today={today} min={min} max={max} />
          </ScrollView>
          <View style={[styles.panel, { backgroundColor: colors.deep, paddingBottom: insets.bottom + 20 }]}>
            <Text style={styles.panelLabel}>{t('calendar.yourDate')}</Text>
            <Text accessibilityLiveRegion="polite" style={styles.panelDate}>
              {draft ? longDay(draft, locale) : t('calendar.tapADay')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('calendar.confirm')}
              accessibilityState={{ disabled: !draft }}
              disabled={!draft}
              onPress={() => {
                onChange(draft);
                setOpen(false);
              }}
              style={[styles.confirm, { backgroundColor: colors.surface, opacity: draft ? 1 : 0.5 }]}
            >
              <Text style={[styles.confirmText, { color: colors.deep }]}>{t('calendar.confirm')}</Text>
            </Pressable>
            {none && value ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('calendar.clear')}
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
                style={styles.clear}
              >
                <Text style={styles.clearText}>{t('calendar.clear')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  arrow: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  month: { flex: 1, textAlign: 'center', fontSize: 21, fontWeight: '800' },
  year: { flex: 1, textAlign: 'center', fontSize: 19, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 3 },
  day: { minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 18, fontWeight: '700' },
  label: { fontSize: 16, fontWeight: '700' },
  field: { minHeight: 64, borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  fieldIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fieldText: { flex: 1, fontSize: 18, fontWeight: '600' },
  sheet: { padding: 20 },
  panel: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 20, gap: 8 },
  panelLabel: { fontSize: 15, fontWeight: '600', color: '#D7E9EE' },
  panelDate: { fontSize: 22, lineHeight: 30, fontWeight: '800', color: '#FFFFFF' },
  confirm: { minHeight: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  confirmText: { fontSize: 19, fontWeight: '800' },
  clear: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', textDecorationLine: 'underline' },
});
