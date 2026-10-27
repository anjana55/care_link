'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { placementStatusValues, type PlacementStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { usePlacements } from '@/lib/hooks/use-international';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { countryName, day } from './shared';

export const PLACEMENT_STYLES: Record<PlacementStatus, string> = {
  PRE_DEPARTURE: 'bg-accent-light text-accent',
  DEPLOYED: 'bg-brand-light text-brand-dark',
  COMPLETED: 'bg-ink/10 text-ink/60',
  ENDED_EARLY: 'bg-danger-light text-danger',
};

const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Caregivers placed abroad. The next welfare check-in for each running
 * placement is shown, overdue ones first in red - the reason this list
 * exists is that nobody abroad goes unchecked.
 */
export function PlacementsTab() {
  const { t, locale } = useTranslation();
  const [filter, setFilter] = useState<'active' | 'all' | PlacementStatus>('active');
  const { data = [], isLoading } = usePlacements(filter);
  const today = todayColombo();
  const sorted = [...data].sort((a, b) => (a.nextCheckin?.dueOn ?? '9999').localeCompare(b.nextCheckin?.dueOn ?? '9999'));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.placements.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t('international.placements.filter')}>
          {(['active', ...placementStatusValues, 'all'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`international.placements.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && sorted.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.placements.empty')}</p>}
      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-2 font-medium">{t('international.placements.caregiver')}</th>
                <th className="px-4 py-2 font-medium">{t('international.placements.where')}</th>
                <th className="px-4 py-2 font-medium">{t('international.enquiries.status')}</th>
                <th className="px-4 py-2 font-medium">{t('international.placements.nextCheckin')}</th>
                <th className="px-4 py-2 font-medium">{t('international.placements.fee')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((p) => {
                const overdue = p.nextCheckin && p.nextCheckin.dueOn < today;
                const unpaid = p.invoices.some((i) => i.status === 'ISSUED');
                const invoiced = p.invoices.some((i) => i.status !== 'VOID' && i.status !== 'DRAFT');
                return (
                  <tr key={p.id} className="hover:bg-paper/60">
                    <td className="px-4 py-3">
                      <Link href={`/international/placements/${p.id}`} className="font-medium text-brand-dark hover:underline">
                        {p.fullName}
                      </Link>
                      <div className="text-xs text-ink/50">{p.registrationNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{p.organisationName}</div>
                      <div className="text-xs text-ink/50">
                        {countryName(p.country, locale)}
                        {p.jobTitle && ` · ${p.jobTitle}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', PLACEMENT_STYLES[p.status])}>{t(`international.placements.status.${p.status}`)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {p.nextCheckin ? (
                        <span className={cn('inline-flex items-center gap-1', overdue && 'font-medium text-danger')}>
                          {overdue && <AlertCircle size={14} aria-hidden />}
                          {t(`international.placements.checkin.${p.nextCheckin.kind}`)} · {day(p.nextCheckin.dueOn, locale)}
                        </span>
                      ) : p.status === 'PRE_DEPARTURE' ? (
                        <span className="text-xs text-ink/50">{t('international.placements.afterArrival')}</span>
                      ) : (
                        <span className="text-ink/40">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {unpaid ? (
                        <span className="text-accent">{t('international.placements.unpaid')}</span>
                      ) : invoiced ? (
                        <span className="text-brand-dark">{t('international.placements.invoiced')}</span>
                      ) : (
                        <span className="text-ink/50">{t('international.placements.notInvoiced')}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
