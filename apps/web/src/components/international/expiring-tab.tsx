'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plane } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useExpiringDocuments, useRunReminders } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { day } from './shared';

const WINDOWS = [30, 90, 180] as const;

/**
 * Passports and documents that have run out or soon will - placed caregivers
 * first, since an expiring passport abroad is the urgent case. Caregivers are
 * reminded by email automatically; this is where staff follow up by phone.
 */
export function ExpiringTab() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [within, setWithin] = useState<(typeof WINDOWS)[number]>(90);
  const { data = [], isLoading } = useExpiringDocuments(within);
  const run = useRunReminders();

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.expiring.hint')}</p>
        <div className="flex items-center gap-2">
          {user?.role === 'ADMIN' && (
            <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
              {t('international.expiring.runNow')}
            </Button>
          )}
          <Select className="sm:w-48" value={within} onChange={(e) => setWithin(Number(e.target.value) as (typeof WINDOWS)[number])} aria-label={t('international.expiring.window')}>
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {t('international.expiring.within', { days: w })}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {run.data && <p className="mb-3 text-sm text-brand-dark">{t('international.expiring.ran', { count: run.data.reminders })}</p>}
      {run.isError && <p className="mb-3 text-sm text-danger">{run.error instanceof Error ? run.error.message : t('common.actionFailed')}</p>}
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.expiring.empty')}</p>}
      {data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-white">
          {data.map((d) => (
            <li key={`${d.caregiverId}-${d.key}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <Link href={`/caregivers/${d.caregiverId}`} className="font-medium text-brand-dark hover:underline">
                  {d.fullName}
                </Link>
                <span className="ml-2 text-xs tabular-nums text-ink/50">{d.registrationNumber}</span>
                {d.placed && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-white">
                    <Plane size={11} aria-hidden />
                    {t('international.expiring.abroad')}
                  </span>
                )}
                <div className="text-xs text-ink/60">{t(`international.expiring.types.${d.documentType}`)}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-ink/70">{day(d.expiresOn, locale)}</span>
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', d.state === 'EXPIRED' ? 'bg-danger-light text-danger' : 'bg-accent-light text-accent')}>
                  {d.state === 'EXPIRED' ? t('international.expiring.expired', { days: -d.daysLeft }) : t('international.expiring.daysLeft', { days: d.daysLeft })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
