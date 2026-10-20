'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePlus2, Search } from 'lucide-react';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useInvoices, useInvoiceSummary } from '@/lib/hooks/use-billing';
import { fmtDate } from '@/lib/colombo-time';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InvoiceStatusBadge, OverdueBadge } from '@/components/billing/billing-badges';
import { cn } from '@/lib/utils';
import type { InvoiceStatus } from '@/lib/api/types';
import { useInitialParam } from '@/lib/use-initial-param';

type Tab = InvoiceStatus | 'overdue' | 'all';
const TABS: Tab[] = ['ISSUED', 'overdue', 'DRAFT', 'PAID', 'VOID', 'all'];

/** Every invoice, what is owed, and what came in. ADMIN and STAFF. */
export default function InvoicesPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ISSUED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useInitialParam('tab', TABS, setTab);
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';

  useEffect(() => {
    if (!authLoading && user && !allowed) router.replace('/dashboard');
  }, [authLoading, user, allowed, router]);

  const { data: summary } = useInvoiceSummary(allowed);
  const { data, isLoading } = useInvoices(
    {
      status: tab === 'all' || tab === 'overdue' ? undefined : tab,
      overdue: tab === 'overdue' || undefined,
      search: search.trim() || undefined,
      page,
      pageSize: 20,
    },
    allowed,
  );

  if (authLoading || !allowed) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;

  const count = (k: Tab) => (!summary ? null : k === 'overdue' ? summary.overdueCount : k === 'all' ? null : summary.byStatus[k]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t('billing.invoices.title')}</h1>
        <Link href="/invoices/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark">
          <FilePlus2 size={16} aria-hidden />
          {t('billing.invoices.new')}
        </Link>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('billing.invoices.subtitle')}</p>

      {summary && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Tile label={t('billing.invoices.outstanding')} value={formatLkr(summary.outstanding)} />
          <Tile label={t('billing.invoices.overdueTotal', { count: summary.overdueCount })} value={formatLkr(summary.overdue)} tone={Number(summary.overdue) > 0 ? 'danger' : undefined} />
          <Tile label={t('billing.invoices.receivedThisMonth')} value={formatLkr(summary.receivedThisMonth)} />
        </div>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink',
            )}
          >
            {t(`billing.invoices.tabs.${key}`)}
            {count(key) !== null && (
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', key === 'overdue' && count(key)! > 0 ? 'bg-danger-light text-danger' : 'bg-paper text-ink/60')}>{count(key)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <Input
          placeholder={t('billing.invoices.search')}
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('billing.invoices.table.number')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.invoices.table.client')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.invoices.table.period')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.invoices.table.due')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('billing.invoices.table.total')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('billing.invoices.table.balance')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.invoices.table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">{t('common.loading')}</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">{t('billing.invoices.empty')}</td>
              </tr>
            )}
            {data?.items.map((inv) => (
              <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/invoices/${inv.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {inv.number ?? t('billing.invoices.draftNumber')}
                  </Link>
                  {inv.bookingReference && <div className="text-xs tabular-nums text-ink/50">{inv.bookingReference}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{inv.clientName}</div>
                  {inv.billToName !== inv.clientName && <div className="text-xs text-ink/50">{inv.billToName}</div>}
                </td>
                <td className="px-4 py-3 text-ink/70">{inv.periodStart && inv.periodEnd ? `${fmtDate(inv.periodStart, locale)} – ${fmtDate(inv.periodEnd, locale)}` : '—'}</td>
                <td className={cn('px-4 py-3', inv.overdue ? 'font-medium text-danger' : 'text-ink/70')}>{inv.dueDate ? fmtDate(inv.dueDate, locale) : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{formatLkr(inv.total)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink/70">{inv.status === 'ISSUED' ? formatLkr(inv.balance) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <InvoiceStatusBadge status={inv.status} label={t(`billing.invoiceStatus.${inv.status}`)} />
                    {inv.overdue && <OverdueBadge label={t('billing.overdue')} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>{t('requests.pageOf', { page: data.page, totalPages: data.totalPages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('clients.previous')}
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('clients.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'danger' ? 'text-danger' : 'text-ink')}>{value}</p>
    </div>
  );
}
