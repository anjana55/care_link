'use client';

import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useShiftCarePlan } from '@/lib/hooks/use-caregiver-portal';
import { cn } from '@/lib/utils';

/**
 * What the caregiver is asked to do on one shift, from the booking's care
 * plan - read-only. The client marks each item; the caregiver sees how it was
 * marked, so they know what the family has recorded.
 */
export function ShiftCarePlan({ shiftId }: { shiftId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useShiftCarePlan(shiftId);
  if (isLoading) return <p className="py-2 text-sm text-ink/50">{t('common.loading')}</p>;
  if (error || !data) return <p className="py-2 text-sm text-red-700">{error instanceof ApiError && error.message ? error.message : t('care.actionError')}</p>;

  return (
    <div className="mt-2 rounded border border-border bg-paper/50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('carePlan.caregiverTitle')}</p>
      {data.planNotes && <p className="mt-2 whitespace-pre-wrap rounded bg-white px-3 py-2 text-sm text-ink">{data.planNotes}</p>}
      {data.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink/50">{t('carePlan.nothingDue')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {data.items.map((i) => {
            const when = i.timing === 'AT_TIMES' ? i.dueKey : i.timing === 'SLOT' && i.slot ? t(`carePlan.slot.${i.slot}`) : t('carePlan.anyTime');
            const marked = i.status === 'NOT_DONE' ? 'notDone' : i.status === 'DONE' ? (i.source === 'AUTO' ? 'auto' : 'done') : null;
            return (
              <li key={`${i.activityId}-${i.dueKey}`} className={cn('flex flex-wrap items-start gap-x-3 gap-y-1 py-2', i.isCritical && 'border-l-2 border-l-amber-500 pl-2')}>
                <span className="w-16 shrink-0 text-xs tabular-nums text-ink/50">{when}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {i.title}
                    {i.isCritical && <AlertTriangle size={12} className="ml-1 inline text-amber-600" aria-label={t('carePlan.important')} />}
                  </p>
                  {i.instructions && <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink/70">{i.instructions}</p>}
                </div>
                {marked && (
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', marked === 'notDone' ? 'bg-red-100 text-red-800' : 'bg-brand-light text-brand-dark')}>
                    {t(`carePlan.outcome.${marked}`)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
