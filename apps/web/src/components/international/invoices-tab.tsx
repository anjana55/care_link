'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PlacementInvoiceStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { usePlacementInvoices } from '@/lib/hooks/use-international';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { day, money } from './shared';

export const INVOICE_STYLES: Record<PlacementInvoiceStatus, string> = {
  DRAFT: 'bg-paper text-ink/70',
  ISSUED: 'bg-accent-light text-accent',
  PAID: 'bg-brand-light text-brand-dark',
  VOID: 'bg-ink/10 text-ink/50',
};

const FILTERS = ['all', 'DRAFT', 'ISSUED', 'overdue', 'PAID', 'VOID'] as const;

/** Placement-fee invoices to overseas employers: the platform's revenue on this path. */
export function InvoicesTab() {
  const { t, locale } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const { data = [], isLoading } = usePlacementInvoices(filter);
  const outstanding = data.filter((i) => i.status === 'ISSUED');
  const byCurrency = new Map<string, number>();
  for (const i of outstanding) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + Number(i.balance));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-ink/60">{t('international.invoices.hint')}</p>
          {byCurrency.size > 0 && (
            <p className="mt-1 text-sm font-medium text-ink">
              {t('international.invoices.outstanding')}: {[...byCurrency].map(([c, n]) => money(n, c, locale)).join(' · ')}
            </p>
          )}
        </div>
        <Select className="sm:w-48" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.invoices.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.invoices.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.invoices.empty')}</p>}
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink/50">
              <tr>
                <th className="px-4 py-2 font-medium">{t('international.invoices.number')}</th>
                <th className="px-4 py-2 font-medium">{t('international.invoices.billTo')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('international.invoices.amount')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('international.invoices.balance')}</th>
                <th className="px-4 py-2 font-medium">{t('international.invoices.due')}</th>
                <th className="px-4 py-2 font-medium">{t('international.enquiries.status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((i) => (
                <tr key={i.id} className="hover:bg-paper/60">
                  <td className="px-4 py-3">
                    <Link href={`/international/invoices/${i.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                      {i.number ?? t('international.invoices.draft')}
                    </Link>
                    <div className="text-xs text-ink/50">{i.enquiryReference}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{i.billToName}</div>
                    <div className="max-w-xs truncate text-xs text-ink/50">{i.description}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(i.amount, i.currency, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{i.status === 'VOID' ? '-' : money(i.balance, i.currency, locale)}</td>
                  <td className={cn('px-4 py-3 tabular-nums', i.overdue && 'font-medium text-danger')}>{day(i.dueDate, locale)}</td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded px-2 py-0.5 text-xs font-medium', i.overdue ? 'bg-danger-light text-danger' : INVOICE_STYLES[i.status])}>
                      {i.overdue ? t('international.invoices.filters.overdue') : t(`international.invoices.filters.${i.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
