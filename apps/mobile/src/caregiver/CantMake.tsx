import { useState } from 'react';
import { View } from 'react-native';
import { CANT_MAKE_NOTE_MAX, type CaregiverShift } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useCantMake } from './api';

/** A shift the caregiver can still say they cannot make: going ahead, not over, not checked in, not paused. */
export function canSayCantMake(s: CaregiverShift, now = Date.now()): boolean {
  return s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > now && !s.checkIn?.checkedInAt && !s.paused;
}

/**
 * "I can't make this shift": a short note if they like, then the office is
 * told and cover is looked for. Once said, what they told the office, with
 * "I can make it after all" while nobody has taken the shift.
 */
export function CantMake({ shift }: { shift: CaregiverShift }) {
  const { t } = useTranslation();
  const colors = useColors();
  const save = useCantMake();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const error = save.error instanceof ApiError && save.error.message ? save.error.message : save.error ? t('care.actionError') : null;

  if (shift.cantMake) {
    return (
      <View testID="cant-make-status" style={{ gap: 4 }}>
        <Text style={{ fontSize: 14, color: colors.danger }}>{t('portal.shifts.cantMake.told')}</Text>
        <Button variant="link" label={t('portal.shifts.cantMake.afterAll')} busy={save.isPending} onPress={() => save.mutate({ shiftId: shift.id, undo: true })} />
      </View>
    );
  }
  if (!canSayCantMake(shift)) return null;
  if (!open) return <Button variant="link" label={t('portal.shifts.cantMake.button')} onPress={() => setOpen(true)} />;
  return (
    <View style={{ gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('portal.shifts.cantMake.title')}</Text>
      <Text style={{ fontSize: 14, color: colors.muted }}>{t('portal.shifts.cantMake.why')}</Text>
      <Field label={t('portal.shifts.cantMake.note')} value={note} onChangeText={setNote} maxLength={CANT_MAKE_NOTE_MAX} multiline />
      <FormError message={error} />
      <Button label={t('portal.shifts.cantMake.send')} busy={save.isPending} onPress={() => save.mutate({ shiftId: shift.id, note: note.trim() || undefined }, { onSuccess: () => setOpen(false) })} />
      <Button variant="link" label={t('common.cancel')} onPress={() => setOpen(false)} />
    </View>
  );
}
