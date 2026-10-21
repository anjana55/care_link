'use client';

import type { PortalShift, ShiftStatus } from '@care-platform/shared';
import { toColombo } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDay, fmtTime } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';

const TONE: Record<ShiftStatus, string> = {
  DRAFT: 'bg-paper text-ink/60',
  SCHEDULED: 'bg-brand-light text-brand-dark',
  COMPLETED: 'bg-paper text-ink/60',
  MISSED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-paper text-ink/40 line-through',
};

/**
 * A plain list of shifts in Sri Lanka time - shared by the client's bookings
 * and the caregiver's own roster. `extra` lets each side add its own detail
 * (the caregiver sees the booking reference and area).
 */
export function ShiftList<T extends PortalShift>({
  shifts,
  extra,
  coverLabel,
  action,
  below,
}: {
  shifts: T[];
  extra?: (s: T) => React.ReactNode;
  coverLabel?: string;
  /** Something to do on a shift (the caregiver's "report a problem"), shown at the row's end. */
  action?: (s: T) => React.ReactNode;
  /** Anything that opens under a row - a form, say. */
  below?: (s: T) => React.ReactNode;
}) {
  const { t, locale } = useTranslation();
  const now = Date.now();
  return (
    <ul className="divide-y divide-border">
      {shifts.map((s) => {
        const past = new Date(s.endsAt).getTime() < now;
        const nextDay = toColombo(s.endsAt).date !== toColombo(s.startsAt).date;
        const underneath = below?.(s);
        return (
          <li key={s.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5', past && !underneath && 'opacity-60')}>
            <span className="w-32 text-sm font-medium text-ink">{fmtDay(s.startsAt, locale)}</span>
            <span className="text-sm tabular-nums text-ink/80">
              {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)}
              {nextDay && <span className="text-ink/50"> (+1)</span>}
            </span>
            <span className="min-w-0 flex-1 text-xs text-ink/50">
              {extra?.(s)}
              {s.isCover && coverLabel && <span className="ml-1 text-amber-700">{coverLabel}</span>}
            </span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', TONE[s.status])}>{t(`bookings.shiftStatus.${s.status}`)}</span>
            {action?.(s)}
            {underneath && <div className="w-full">{underneath}</div>}
          </li>
        );
      })}
    </ul>
  );
}
