import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { toColombo, type PortalShift } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from './Text';
import { fmtDay, fmtTime } from './dates';

/**
 * One shift in Sri Lanka time - the client's bookings and the caregiver's
 * roster show them the same way (overnight shifts end "+1", covers noted, past
 * ones dimmed). `extra` adds a line, `children` anything under the row.
 */
export function ShiftRow({ shift: s, coverLabel, extra, children }: { shift: PortalShift; coverLabel: string; extra?: string; children?: ReactNode }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const past = new Date(s.endsAt).getTime() < Date.now();
  const nextDay = toColombo(s.endsAt).date !== toColombo(s.startsAt).date;
  const tone = s.status === 'MISSED' ? colors.danger : s.status === 'SCHEDULED' ? colors.brand : colors.muted;
  return (
    <View style={[styles.shift, { borderColor: colors.border }]}>
      <View style={[styles.row, { opacity: past && !children ? 0.6 : 1 }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{fmtDay(s.startsAt, locale)}</Text>
          <Text style={{ fontSize: 15, color: colors.ink }}>
            {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
            {nextDay ? <Text style={{ color: colors.muted }}> (+1)</Text> : null}
            {s.isCover ? <Text style={{ color: colors.muted }}> {coverLabel}</Text> : null}
          </Text>
          {extra ? <Text style={{ fontSize: 13, color: colors.muted }}>{extra}</Text> : null}
        </View>
        <Text style={[styles.badge, { color: tone, borderColor: tone, textDecorationLine: s.status === 'CANCELLED' ? 'line-through' : 'none' }]}>
          {t(`bookings.shiftStatus.${s.status}`)}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shift: { paddingVertical: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
