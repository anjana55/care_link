'use client';

import { useState } from 'react';
import type { CaregiverShift } from '@care-platform/shared';
import { checkInOpen } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useShiftCheckIn, useShiftCheckOut } from '@/lib/hooks/use-caregiver-portal';
import { devicePosition } from '@/lib/device-position';
import { fmtTime } from '@/lib/colombo-time';

/** One line on where a shift's check-in stands, for the caregiver. Nothing when check-in is off or there is nothing to say yet. */
export function CheckInStatus({ shift }: { shift: CaregiverShift }) {
  const { t, locale } = useTranslation();
  const c = shift.checkIn;
  if (!c) return null;
  if (c.checkedInAt && c.checkedOutAt) return <span className="ml-1 text-brand-dark">· {t('checkIn.caregiver.out', { in: fmtTime(c.checkedInAt, locale), out: fmtTime(c.checkedOutAt, locale) })}</span>;
  if (c.checkedInAt) return <span className="ml-1 font-medium text-brand-dark">· {t('checkIn.caregiver.in', { time: fmtTime(c.checkedInAt, locale) })}</span>;
  if (c.codeLocked) return <span className="ml-1 text-danger">· {t('checkIn.caregiver.locked')}</span>;
  if (c.state === 'NOT_RECORDED' && shift.status === 'SCHEDULED') return <span className="ml-1">· {t('checkIn.caregiver.notRecorded')}</span>;
  return null;
}

/** The caregiver's button on a shift: "Check in" while it is open, "Check out" once they are in. */
export function CheckInAction({ shift, onOpen }: { shift: CaregiverShift; onOpen: () => void }) {
  const { t } = useTranslation();
  const checkOut = useShiftCheckOut();
  const c = shift.checkIn;
  if (!c || shift.status !== 'SCHEDULED') return null;
  if (c.state === 'IN') {
    return (
      <button
        type="button"
        disabled={checkOut.isPending}
        className="rounded border border-brand px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-light disabled:opacity-60"
        onClick={async () => checkOut.mutate({ shiftId: shift.id, ...(await devicePosition()) })}
      >
        {t('checkIn.caregiver.checkOut')}
      </button>
    );
  }
  if (checkInOpen(c.state) && !c.codeLocked) {
    return (
      <button type="button" className="rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark" onClick={onOpen}>
        {t('checkIn.caregiver.checkIn')}
      </button>
    );
  }
  return null;
}

/** The four digits the client reads out. The phone's position goes along when the browser gives one. */
export function CheckInForm({ shift, onDone }: { shift: CaregiverShift; onDone: () => void }) {
  const { t } = useTranslation();
  const checkIn = useShiftCheckIn();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const id = `arrival-code-${shift.id}`;
  const error = checkIn.error as Error | null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 4 || busy) return;
    setBusy(true);
    const position = await devicePosition();
    checkIn.mutate({ shiftId: shift.id, code, ...position }, { onSuccess: onDone, onSettled: () => setBusy(false) });
  };

  return (
    <form onSubmit={submit} className="mt-2 rounded border border-border bg-paper p-3">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {t('checkIn.caregiver.codeLabel')}
      </label>
      <input
        id={id}
        value={code}
        onChange={(e) => {
          checkIn.reset();
          setCode(e.target.value.replace(/\D/g, '').slice(0, 4));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{4}"
        aria-describedby={`${id}-hint`}
        className="mt-1 w-32 rounded border border-border bg-white px-3 py-2 text-center text-2xl tabular-nums tracking-[0.3em] text-ink"
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink/60">
        {t('checkIn.caregiver.codeHint')}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error.message || t('checkIn.caregiver.failed')}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={code.length !== 4 || busy} className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60">
          {t('checkIn.caregiver.submit')}
        </button>
        <button type="button" onClick={onDone} className="rounded border border-border bg-white px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
          {t('checkIn.caregiver.cancel')}
        </button>
      </div>
    </form>
  );
}
