import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tint, type IconName } from './visual';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from './fonts';
import { Text } from './Text';
import { Button } from './controls';

export interface Choice<V extends string | number> {
  value: V;
  label: string;
  /** Shown on tiles. */
  icon?: IconName;
}

/**
 * One-tap choices. Single choice unless `multiple`. `layout`: a wrapping row of
 * chips (the default), `tiles` - two to a row, each with its icon - or
 * `scroll`, one sideways-scrolling row for long runs such as dates.
 */
export function Chips<V extends string | number>({
  label,
  choices,
  selected,
  onToggle,
  multiple = false,
  error,
  layout = 'wrap',
}: {
  label?: string;
  choices: Choice<V>[];
  selected: V[];
  onToggle: (value: V) => void;
  multiple?: boolean;
  error?: string | null;
  layout?: 'wrap' | 'tiles' | 'scroll';
}) {
  const colors = useColors();
  const items = choices.map((c) => {
    const on = selected.includes(c.value);
    const a11y = {
      accessibilityRole: multiple ? ('checkbox' as const) : ('radio' as const),
      accessibilityState: multiple ? { checked: on } : { selected: on },
      onPress: () => onToggle(c.value),
    };
    if (layout === 'tiles') {
      return (
        <Pressable
          key={String(c.value)}
          {...a11y}
          style={[styles.tile, { borderColor: on ? colors.brand : colors.border, backgroundColor: on ? tint(colors.brand, 0.08) : colors.surface }]}
        >
          {c.icon ? (
            <View style={[styles.tileIcon, { backgroundColor: on ? colors.brand : tint(colors.accent, 0.12) }]}>
              <Ionicons name={c.icon} size={22} color={on ? colors.brandText : colors.accent} />
            </View>
          ) : null}
          <Text style={{ fontSize: 15, lineHeight: 20, color: colors.ink, fontWeight: on ? '700' : '500' }}>{c.label}</Text>
          {on ? <Ionicons name="checkmark-circle" size={20} color={colors.brand} style={styles.tileCheck} /> : null}
        </Pressable>
      );
    }
    return (
      <Pressable
        key={String(c.value)}
        {...a11y}
        style={[styles.chip, { borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface }]}
      >
        <Text style={{ fontSize: 15, color: on ? colors.brandText : colors.ink, fontWeight: on ? '600' : '400' }}>{c.label}</Text>
      </Pressable>
    );
  });
  return (
    <View style={styles.group}>
      {label ? <Text style={[styles.label, { color: colors.ink }]}>{label}</Text> : null}
      {layout === 'scroll' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole={multiple ? undefined : 'radiogroup'}
          accessibilityLabel={label}
          contentContainerStyle={styles.scrollRow}
        >
          {items}
        </ScrollView>
      ) : (
        <View accessibilityRole={multiple ? undefined : 'radiogroup'} accessibilityLabel={label} style={layout === 'tiles' ? styles.tiles : styles.chips}>
          {items}
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A field that opens a full list to pick from (districts, cities), with a
 * filter box for long lists. `none` adds a "no choice" row at the top.
 */
export function SelectField<V extends string | number>({
  label,
  choices,
  value,
  onChange,
  none,
  error,
  disabled = false,
}: {
  label: string;
  choices: Choice<V>[];
  value: V | null;
  onChange: (value: V | null) => void;
  none?: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const current = choices.find((c) => c.value === value);
  const shown = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase();
    return f ? choices.filter((c) => c.label.toLocaleLowerCase().includes(f)) : choices;
  }, [choices, filter]);
  const rows: Choice<V | ''>[] = none ? [{ value: '', label: none }, ...shown] : shown;

  const pick = (v: V | '') => {
    onChange(v === '' ? null : v);
    setOpen(false);
    setFilter('');
  };

  return (
    <View style={styles.group}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: current?.label ?? none ?? '' }}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.select, { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface, opacity: disabled ? 0.5 : 1 }]}
      >
        <Text style={{ fontSize: 17, color: current ? colors.ink : colors.muted }}>{current?.label ?? none ?? '—'}</Text>
        <Text style={{ color: colors.muted }}>▾</Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={{ fontSize: 14, color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.ink }]}>
            {label}
          </Text>
          {choices.length > 12 ? (
            <TextInput
              accessibilityLabel={label}
              value={filter}
              onChangeText={setFilter}
              autoCorrect={false}
              placeholder="…"
              placeholderTextColor={colors.muted}
              style={[styles.filter, { borderColor: colors.border, color: colors.ink, backgroundColor: colors.surface, fontFamily: fontFamilyFor(locale, false) }]}
            />
          ) : null}
          <FlatList
            data={rows}
            keyExtractor={(c) => String(c.value)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const on = item.value === (value ?? '');
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => pick(item.value)}
                  style={[styles.row, { borderColor: colors.border }]}
                >
                  <Text style={{ fontSize: 17, color: colors.ink, fontWeight: on ? '700' : '400' }}>{item.label}</Text>
                </Pressable>
              );
            }}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 22, borderWidth: 1 },
  scrollRow: { gap: 8, paddingRight: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexBasis: '47%', flexGrow: 1, minHeight: 96, borderWidth: 1.5, borderRadius: 16, padding: 12, gap: 8, justifyContent: 'flex-start' },
  tileIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileCheck: { position: 'absolute', top: 10, right: 10 },
  select: { minHeight: 52, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheet: { flex: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 32, gap: 12 },
  sheetTitle: { fontSize: 22, fontWeight: '700' },
  filter: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 17 },
  row: { minHeight: 52, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
