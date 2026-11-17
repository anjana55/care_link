'use client';

import { useState } from 'react';
import { CANT_MAKE_NOTE_MAX, type CaregiverShift } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useCantMake } from '@/lib/hooks/use-caregiver-portal';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';

/** A shift the caregiver can still say they cannot make: going ahead, not over, not checked in, not paused. */
export function canSayCantMake(s: CaregiverShift, now = Date.now()): boolean {
  return s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() > now && !s.checkIn?.checkedInAt && !s.paused;
}

/** What the caregiver told the office, with "I can make it after all" while nobody has taken it. */
export function CantMakeStatus({ shift }: { shift: CaregiverShift }) {
  const { t } = useTranslation();
  const save = useCantMake();
  if (!shift.cantMake) return null;
  return (
    <span className="mt-1 block text-sm text-amber-800" data-testid="cant-make-status">
      {t('portal.shifts.cantMake.told')}{' '}
      <button type="button" className="font-medium text-brand hover:underline disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate({ shiftId: shift.id, undo: true })}>
        {t('portal.shifts.cantMake.afterAll')}
      </button>
    </span>
  );
}

/** "I can't make this shift": an optional short note, then the office is told and cover is looked for. */
export function CantMakeForm({ shift, onDone }: { shift: CaregiverShift; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useCantMake();
  const [note, setNote] = useState('');
  const id = `cant-make-${shift.id}`;
  const error = save.error instanceof ApiError && save.error.message ? save.error.message : save.error ? t('care.actionError') : null;
  return (
    <form
      className="mt-2 rounded-DEFAULT border border-border bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ shiftId: shift.id, note: note.trim() || undefined }, { onSuccess: onDone });
      }}
    >
      <p className="text-sm font-medium text-ink">{t('portal.shifts.cantMake.title')}</p>
      <p className="mt-0.5 text-xs text-ink/60">{t('portal.shifts.cantMake.why')}</p>
      <Label htmlFor={id} className="mt-3">{t('portal.shifts.cantMake.note')}</Label>
      <Textarea id={id} rows={2} maxLength={CANT_MAKE_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>{t('portal.shifts.cantMake.send')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}
