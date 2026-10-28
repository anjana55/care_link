'use client';

import { useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, type CareChecklistItem, type CareChecklistShift } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useMarkCareItem, useMyCareDay, useSetCareReminders } from '@/lib/hooks/use-client-care';
import { fmtDate, fmtDay, fmtTime } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';

/**
 * Today's care: the client ticks off what the caregiver did, item by item,
 * from the booking's care plan. Each shift stays open until midnight at the
 * end of the day it ends; anything still unmarked then counts as done, and the
 * day becomes read-only (a mistake after that goes through "Report a problem").
 */
export function TodaysCare() {
  const { t, locale } = useTranslation();
  const [date, setDate] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useMyCareDay(date);
  const reminders = useSetCareReminders();

  // Nothing to show for a client with no care plans at all: keep the page as it was.
  if (isLoading || isError || !data) {
    if (isError) {
      return (
        <section className="mb-6 rounded-lg border border-border bg-white p-4 text-sm text-ink/60">
          {t('carePlan.loadError')}{' '}
          <button type="button" className="font-medium text-brand hover:underline" onClick={() => refetch()}>
            {t('carePlan.retry')}
          </button>
        </section>
      );
    }
    return null;
  }
  if (!data.hasCarePlans) return null;

  const day = data.date;
  const open = data.shifts.filter((s) => s.canMark).flatMap((s) => s.items.filter((i) => i.status === null)).length;

  return (
    <section className="mb-6 rounded-lg border border-border bg-white p-4 sm:p-5" aria-labelledby="todays-care">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="todays-care" className="text-base font-semibold text-ink">
          {day === data.today ? t('carePlan.todayTitle') : t('carePlan.dayTitle', { date: fmtDate(day, locale) })}
        </h2>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded p-1.5 text-ink/60 hover:bg-paper" aria-label={t('carePlan.previousDay')} onClick={() => setDate(addDays(day, -1))}>
            <ChevronLeft size={16} />
          </button>
          {day !== data.today && (
            <button type="button" className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-paper" onClick={() => setDate(null)}>
              {t('carePlan.today')}
            </button>
          )}
          <button type="button" className="rounded p-1.5 text-ink/60 hover:bg-paper" aria-label={t('carePlan.nextDay')} onClick={() => setDate(addDays(day, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-ink/60">{t('carePlan.intro')}</p>

      {open > 0 && (
        <p role="status" className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('carePlan.leftToReview', { count: open })}
        </p>
      )}

      {data.shifts.length === 0 && <p className="mt-4 text-sm text-ink/50">{t('carePlan.nothingThisDay')}</p>}
      <div className="mt-4 space-y-4">
        {data.shifts.map((s) => (
          <ShiftChecklist key={s.shiftId} shift={s} date={date} />
        ))}
      </div>

      <label className="mt-4 flex items-start gap-2 border-t border-border pt-3 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
          checked={data.reminders}
          disabled={reminders.isPending}
          onChange={(e) => reminders.mutate(e.target.checked)}
        />
        <span>
          {t('carePlan.reminders')}
          <span className="block text-xs text-ink/50">{t('carePlan.remindersHint')}</span>
        </span>
      </label>
    </section>
  );
}

function ShiftChecklist({ shift: s, date }: { shift: CareChecklistShift; date: string | null }) {
  const { t, locale } = useTranslation();
  return (
    <div className="rounded border border-border">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-paper px-3 py-2 text-sm">
        <span className="font-medium tabular-nums text-ink">
          {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)}
        </span>
        <span className="text-xs text-ink/50">{s.bookingReference}</span>
        {s.isCover && <span className="text-xs text-amber-700">{t('account.bookings.cover')}</span>}
        <span className="ml-auto text-xs text-ink/50">
          {s.locked ? t('carePlan.closed') : s.canMark ? t('carePlan.openUntil', { day: fmtDay(new Date(new Date(s.cutOffAt).getTime() - 60_000).toISOString(), locale) }) : t('carePlan.notStarted')}
        </span>
      </div>
      {s.planNotes && <p className="whitespace-pre-wrap border-b border-border px-3 py-2 text-sm text-ink/80">{s.planNotes}</p>}
      {s.items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-ink/50">{t('carePlan.nothingDue')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {s.items.map((i) => (
            <ChecklistItem key={`${i.activityId}-${i.dueKey}`} shift={s} item={i} date={date} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChecklistItem({ shift, item: i, date }: { shift: CareChecklistShift; item: CareChecklistItem; date: string | null }) {
  const { t } = useTranslation();
  const mark = useMarkCareItem(date);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState(i.reason ?? '');
  const when = i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlan.slot.${i.slot}`) : t('carePlan.anyTime');
  // Marking Not done leaves the reason box open; saving a reason (or marking Done) closes it.
  const send = (status: 'DONE' | 'NOT_DONE', why?: string, close = true) =>
    mark.mutate({ shiftId: shift.shiftId, activityId: i.activityId, dueKey: i.dueKey, status, reason: why?.trim() || null }, { onSuccess: () => close && setReasonOpen(false) });

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-ink/50">{when}</span>
        {/* A minimum width so on a phone the buttons drop below the title instead of squeezing it. */}
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium text-ink">
            {i.title}
            {i.isCritical && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 align-middle text-xs font-normal text-amber-800">
                <AlertTriangle size={11} aria-hidden />
                {t('carePlan.important')}
              </span>
            )}
          </p>
          {i.instructions && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink/60">{i.instructions}</p>}
          {i.status === 'NOT_DONE' && i.reason && !reasonOpen && <p className="mt-0.5 text-xs text-ink/60">“{i.reason}”</p>}
        </div>
        {shift.canMark ? (
          <div className="ml-auto flex shrink-0 gap-1.5" role="group" aria-label={i.title}>
            <button
              type="button"
              aria-pressed={i.status === 'DONE'}
              disabled={mark.isPending}
              onClick={() => send('DONE')}
              className={cn(
                'inline-flex h-9 items-center gap-1 rounded border px-3 text-sm font-medium',
                i.status === 'DONE' ? 'border-brand bg-brand text-white' : 'border-border bg-white text-ink hover:bg-paper',
              )}
            >
              <Check size={15} aria-hidden />
              {t('carePlan.done')}
            </button>
            <button
              type="button"
              aria-pressed={i.status === 'NOT_DONE'}
              disabled={mark.isPending}
              onClick={() => {
                setReasonOpen(true);
                if (i.status !== 'NOT_DONE') send('NOT_DONE', undefined, false);
              }}
              className={cn(
                'inline-flex h-9 items-center gap-1 rounded border px-3 text-sm font-medium',
                i.status === 'NOT_DONE' ? 'border-red-700 bg-red-700 text-white' : 'border-border bg-white text-ink hover:bg-paper',
              )}
            >
              <X size={15} aria-hidden />
              {t('carePlan.notDone')}
            </button>
          </div>
        ) : (
          <Outcome item={i} />
        )}
      </div>
      {shift.canMark && reasonOpen && i.status === 'NOT_DONE' && (
        <div className="mt-2 flex flex-wrap gap-2 pl-[4.75rem]">
          <input
            className="h-9 min-w-[12rem] flex-1 rounded border border-border px-3 text-sm focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            placeholder={t('carePlan.reasonPlaceholder')}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="button" className="h-9 rounded bg-brand px-3 text-sm font-medium text-white hover:bg-brand-dark" disabled={mark.isPending} onClick={() => send('NOT_DONE', reason)}>
            {t('carePlan.saveReason')}
          </button>
        </div>
      )}
      {mark.isError && (
        <p role="alert" className="mt-1 pl-[4.75rem] text-xs text-red-700">
          {mark.error instanceof ApiError && mark.error.message ? mark.error.message : t('care.actionError')}
        </p>
      )}
    </li>
  );
}

function Outcome({ item: i }: { item: CareChecklistItem }) {
  const { t } = useTranslation();
  if (!i.status) return <span className="shrink-0 rounded-full bg-paper px-2.5 py-0.5 text-xs text-ink/50">{t('carePlan.outcome.open')}</span>;
  const key = i.status === 'NOT_DONE' ? 'notDone' : i.source === 'AUTO' ? 'auto' : i.source === 'STAFF' ? 'staff' : 'done';
  const tone = { done: 'bg-brand-light text-brand-dark', auto: 'bg-paper text-ink/50', staff: 'bg-brand-light text-brand-dark', notDone: 'bg-red-100 text-red-800' }[key];
  return <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', tone)}>{t(`carePlan.outcome.${key}`)}</span>;
}
