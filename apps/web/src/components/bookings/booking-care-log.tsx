'use client';

import { useState } from 'react';
import { AlertTriangle, ListChecks } from 'lucide-react';
import { addDays, colomboToday, type CareChecklistItem, type CareChecklistShift } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useCareLog, useCorrectCareRecord } from '@/lib/hooks/use-care-plans';
import { fmtDateTime, fmtDay, fmtTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** How an item's outcome reads, and its colour. */
export function outcomeKey(i: Pick<CareChecklistItem, 'status' | 'source'>): 'open' | 'done' | 'auto' | 'notDone' {
  if (!i.status) return 'open';
  if (i.status === 'NOT_DONE') return 'notDone';
  return i.source === 'AUTO' ? 'auto' : 'done';
}
const TONE = {
  open: 'bg-paper text-ink/60',
  done: 'bg-brand-light text-brand-dark',
  auto: 'bg-ink/5 text-ink/50',
  notDone: 'bg-red-100 text-red-800',
} as const;

/**
 * What happened on each shift against the care plan: the client's ticks,
 * what the midnight rule filled in, and staff corrections (with a reason).
 */
export function BookingCareLog({ bookingId }: { bookingId: string }) {
  const { t, locale } = useTranslation();
  const today = colomboToday();
  const [range, setRange] = useState({
    from: addDays(today, -13),
    to: addDays(today, 1),
  });
  const { data, isLoading } = useCareLog(bookingId, range);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <ListChecks size={16} aria-hidden />
          {t('carePlans.log.title')}
        </CardTitle>
        <div className="flex items-center gap-1 text-xs">
          <Input
            type="date"
            className="h-8 w-36"
            aria-label={t('carePlans.log.from')}
            value={range.from}
            max={range.to}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <span className="text-ink/40">–</span>
          <Input
            type="date"
            className="h-8 w-36"
            aria-label={t('carePlans.log.to')}
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {data && (
          <>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {(['due', 'done', 'notDone', 'auto', 'open'] as const).map((k) => (
                <div key={k} className="flex items-baseline gap-1">
                  <dt className="text-ink/50">{t(`carePlans.log.totals.${k}`)}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{data.totals[k]}</dd>
                </div>
              ))}
              {data.totals.criticalNotConfirmed > 0 && (
                <div className="flex items-center gap-1 text-accent">
                  <AlertTriangle size={13} aria-hidden />
                  {t('carePlans.log.criticalNotConfirmed', {
                    count: data.totals.criticalNotConfirmed,
                  })}
                </div>
              )}
            </dl>
            {data.shifts.length === 0 && <p className="text-sm text-ink/50">{t('carePlans.log.empty')}</p>}
            <ul className="space-y-4">
              {data.shifts.map((s) => (
                <ShiftLog key={s.shiftId} bookingId={bookingId} shift={s} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ShiftLog({ shift: s, bookingId: id }: { shift: CareChecklistShift; bookingId: string }) {
  const { t, locale } = useTranslation();
  return (
    <li className="rounded border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-paper px-3 py-2 text-sm">
        <span className="font-medium text-ink">{fmtDay(s.startsAt, locale)}</span>
        <span className="tabular-nums text-ink/70">
          {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)}
        </span>
        {s.caregiverName && (
          <span className="text-ink/60">
            {s.caregiverName}
            {s.isCover && <span className="ml-1 text-amber-700">{t('carePlans.log.cover')}</span>}
          </span>
        )}
        <span className="ml-auto text-xs text-ink/50">
          {s.locked
            ? t('carePlans.log.closed')
            : t('carePlans.log.openUntil', {
                // The cut-off is the midnight that ends this day.
                day: fmtDay(new Date(new Date(s.cutOffAt).getTime() - 60_000).toISOString(), locale),
              })}
        </span>
      </div>
      {s.items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-ink/50">{t('carePlans.log.nothingDue')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {s.items.map((i) => (
            <LogItem key={`${i.activityId}-${i.dueKey}`} bookingId={id} shift={s} item={i} />
          ))}
        </ul>
      )}
    </li>
  );
}

function LogItem({ bookingId: id, shift, item: i }: { bookingId: string; shift: CareChecklistShift; item: CareChecklistItem }) {
  const { t, locale } = useTranslation();
  const correct = useCorrectCareRecord(id);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'DONE' | 'NOT_DONE'>(i.status === 'NOT_DONE' ? 'DONE' : 'NOT_DONE');
  const [reason, setReason] = useState('');
  const key = outcomeKey(i);
  const when = i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlans.slotShort.${i.slot}`) : t('carePlans.timing.ANY');
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-20 shrink-0 text-xs tabular-nums text-ink/50">{when}</span>
        <span className="min-w-0 flex-1 text-ink">
          {i.title}
          {i.isCritical && <AlertTriangle size={12} className="ml-1 inline text-accent" aria-label={t('carePlans.critical')} />}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TONE[key])}>{t(`carePlans.outcome.${key}`)}</span>
        {shift.canMark && !open && (
          <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setOpen(true)}>
            {t('carePlans.log.correct')}
          </button>
        )}
      </div>
      {(i.reason || i.recordedBy || (i.source && i.source !== 'AUTO')) && (
        <p className="mt-0.5 pl-[5.75rem] text-xs text-ink/50">
          {i.reason && <span className="text-ink/70">“{i.reason}” </span>}
          {i.source && i.source !== 'AUTO' && t(`carePlans.log.source.${i.source}`)}
          {i.recordedBy && ` · ${i.recordedBy}`}
          {i.recordedAt && i.source !== 'AUTO' && ` · ${fmtDateTime(i.recordedAt, locale)}`}
        </p>
      )}
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-[5.75rem]">
          <Select className="h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value as 'DONE' | 'NOT_DONE')}>
            <option value="DONE">{t('carePlans.outcome.done')}</option>
            <option value="NOT_DONE">{t('carePlans.outcome.notDone')}</option>
          </Select>
          <Input
            className="h-8 min-w-[14rem] flex-1"
            placeholder={t('carePlans.log.reason')}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!reason.trim() || correct.isPending}
            onClick={() =>
              correct.mutate(
                {
                  shiftId: shift.shiftId,
                  activityId: i.activityId,
                  dueKey: i.dueKey,
                  status,
                  reason: reason.trim(),
                },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {t('common.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          {correct.isError && (
            <span className="text-xs text-danger">
              {correct.error instanceof ApiError && correct.error.message ? correct.error.message : t('requests.detail.saveFailed')}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
