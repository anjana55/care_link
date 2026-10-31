import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from './fonts';
import { Text } from './Text';
import { Button } from './controls';

export interface Choice<V extends string | number> {
  value: V;
  label: string;
}

/** One-tap choices in a wrapping row. Single choice unless `multiple`. */
export function Chips<V extends string | number>({
  label,
  choices,
  selected,
  onToggle,
  multiple = false,
  error,
}: {
  label?: string;
  choices: Choice<V>[];
  selected: V[];
  onToggle: (value: V) => void;
  multiple?: boolean;
  error?: string | null;
}) {
  const colors = useColors();
  return (
    <View style={styles.group}>
      {label ? <Text style={[styles.label, { color: colors.ink }]}>{label}</Text> : null}
      <View accessibilityRole={multiple ? undefined : 'radiogroup'} accessibilityLabel={label} style={styles.chips}>
        {choices.map((c) => {
          const on = selected.includes(c.value);
          return (
            <Pressable
              key={String(c.value)}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityState={multiple ? { checked: on } : { selected: on }}
              onPress={() => onToggle(c.value)}
              style={[
                styles.chip,
                { borderColor: on ? colors.brand : colors.border, backgroundColor: on ? colors.brand : colors.surface },
              ]}
            >
              <Text style={{ fontSize: 15, color: on ? colors.brandText : colors.ink, fontWeight: on ? '600' : '400' }}>{c.label}</Text>
            </Pressable>
          );
        })}
      </View>
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
  select: { minHeight: 52, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheet: { flex: 1, paddingHorizontal: 24, paddingTop: 56, paddingBottom: 32, gap: 12 },
  sheetTitle: { fontSize: 22, fontWeight: '700' },
  filter: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, fontSize: 17 },
  row: { minHeight: 52, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
});
