import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { useShiftCarePlan } from './api';

/**
 * What the caregiver is asked to do on one shift, from the booking's care
 * plan - read-only, as decided. The family marks each item; the caregiver sees
 * how it was marked, so they know what has been recorded.
 */
export function ShiftCarePlan({ shiftId }: { shiftId: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { data, isLoading, error } = useShiftCarePlan(shiftId);
  if (isLoading) return <ActivityIndicator color={colors.brand} style={{ marginVertical: 8 }} />;
  if (error || !data) {
    return <Text style={{ color: colors.danger }}>{error instanceof ApiError && error.message ? error.message : t('care.actionError')}</Text>;
  }
  return (
    <View style={[styles.box, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <Text style={[styles.label, { color: colors.muted }]}>{t('carePlan.caregiverTitle')}</Text>
      {data.planNotes ? <Text style={[styles.notes, { color: colors.ink, backgroundColor: colors.surface }]}>{data.planNotes}</Text> : null}
      {data.items.length === 0 ? <Text style={{ color: colors.muted }}>{t('carePlan.nothingDue')}</Text> : null}
      {data.items.map((i) => {
        const when = i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlan.slot.${i.slot}`) : t('carePlan.anyTime');
        const marked = i.status === 'NOT_DONE' ? 'notDone' : i.status === 'DONE' ? (i.source === 'AUTO' ? 'auto' : 'done') : null;
        return (
          <View key={`${i.activityId}-${i.dueKey}`} style={[styles.item, { borderColor: colors.border }, i.isCritical && { borderLeftWidth: 3, borderLeftColor: colors.danger, paddingLeft: 8 }]}>
            <Text style={{ fontSize: 13, color: colors.muted }}>{when}</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
              {i.title}
              {i.isCritical ? <Text style={{ fontSize: 13, color: colors.danger }}>{`  ⚠ ${t('carePlan.important')}`}</Text> : null}
            </Text>
            {i.instructions ? <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{i.instructions}</Text> : null}
            {marked ? (
              <Text style={[styles.badge, { color: marked === 'notDone' ? colors.danger : colors.brand, borderColor: marked === 'notDone' ? colors.danger : colors.brand }]}>
                {t(`carePlan.outcome.${marked}`)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  notes: { borderRadius: 8, padding: 10, fontSize: 15, lineHeight: 22 },
  item: { paddingVertical: 8, gap: 2, borderTopWidth: StyleSheet.hairlineWidth },
  badge: { alignSelf: 'flex-start', marginTop: 4, fontSize: 12, fontWeight: '600', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
