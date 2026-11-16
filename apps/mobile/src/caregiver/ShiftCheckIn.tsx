import { useState } from 'react';
import { View } from 'react-native';
import { checkInOpen, type CaregiverShift } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { fmtTime } from '@/ui/dates';
import { useShiftCheckIn, useShiftCheckOut } from './api';
import { phonePosition, type Position } from './position';

/**
 * Check-in for one of the caregiver's shifts, as on the website: while it is
 * open, "Check in" asks for the four digits the client reads out; once in,
 * "Check out". Where the phone is goes along when the caregiver allows it,
 * and is never needed. Renders nothing while check-in is switched off or
 * there is nothing to do or say yet.
 */
export function ShiftCheckIn({ shift, locate = phonePosition }: { shift: CaregiverShift; locate?: () => Promise<Position> }) {
  const { t } = useTranslation();
  const colors = useColors();
  const checkIn = useShiftCheckIn();
  const checkOut = useShiftCheckOut();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const c = shift.checkIn;
  // Paused by the office: nobody should go, so there is nothing to check in to.
  if (shift.paused && !c?.checkedInAt) return <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>{t('portal.shifts.paused')}</Text>;
  if (!c || (shift.status !== 'SCHEDULED' && shift.status !== 'COMPLETED')) return null;

  if (c.checkedInAt && c.checkedOutAt) return <Text style={{ fontSize: 14, color: colors.brand }}>{t('checkIn.caregiver.out', { in: fmtTime(c.checkedInAt), out: fmtTime(c.checkedOutAt) })}</Text>;
  if (c.checkedInAt) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand }}>{t('checkIn.caregiver.in', { time: fmtTime(c.checkedInAt) })}</Text>
        {shift.status === 'SCHEDULED' ? (
          <Button
            variant="secondary"
            label={t('checkIn.caregiver.checkOut')}
            busy={busy || checkOut.isPending}
            onPress={async () => {
              setBusy(true);
              const position = await locate();
              checkOut.mutate({ shiftId: shift.id, ...position }, { onSettled: () => setBusy(false) });
            }}
          />
        ) : null}
        <FormError message={checkOut.error ? (checkOut.error as Error).message || t('checkIn.caregiver.failed') : null} />
      </View>
    );
  }
  if (shift.status !== 'SCHEDULED') return null;
  if (c.codeLocked) return <Text style={{ fontSize: 14, color: colors.danger }}>{t('checkIn.caregiver.locked')}</Text>;
  if (c.state === 'NOT_RECORDED') return <Text style={{ fontSize: 14, color: colors.muted }}>{t('checkIn.caregiver.notRecorded')}</Text>;
  if (!checkInOpen(c.state)) return null;

  if (!open) return <Button label={t('checkIn.caregiver.checkIn')} onPress={() => setOpen(true)} />;

  const send = async () => {
    if (code.length !== 4 || busy) return;
    setBusy(true);
    const position = await locate();
    checkIn.mutate({ shiftId: shift.id, code, ...position }, { onSuccess: () => setOpen(false), onSettled: () => setBusy(false) });
  };
  return (
    <View style={{ gap: 8 }}>
      <Field
        label={t('checkIn.caregiver.codeLabel')}
        hint={t('checkIn.caregiver.codeHint')}
        value={code}
        onChangeText={(v) => {
          checkIn.reset();
          setCode(v.replace(/\D/g, '').slice(0, 4));
        }}
        keyboardType="number-pad"
        maxLength={4}
        textContentType="oneTimeCode"
      />
      <FormError message={checkIn.error ? (checkIn.error as Error).message || t('checkIn.caregiver.failed') : null} />
      <Button label={t('checkIn.caregiver.submit')} busy={busy || checkIn.isPending} disabled={code.length !== 4} onPress={() => void send()} />
      <Button variant="secondary" label={t('checkIn.caregiver.cancel')} onPress={() => setOpen(false)} />
    </View>
  );
}
