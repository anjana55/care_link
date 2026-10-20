'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Wallet } from 'lucide-react';
import { addDays, colomboToday, formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useCreatePayout, useGeneratePayouts, usePayoutSummary, usePayouts } from '@/lib/hooks/use-billing';
import { fmtDate } from '@/lib/colombo-time';
import { CaregiverPicker } from '@/components/requests/caregiver-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { PayoutStatusBadge } from '@/components/billing/billing-badges';
import { cn } from '@/lib/utils';
import type { PayoutStatus } from '@/lib/api/types';
import { useInitialParam } from '@/lib/use-initial-param';

const TABS: (PayoutStatus | 'all')[] = ['DRAFT', 'APPROVED', 'PAID', 'VOID', 'all'];

function lastMonth() {
  const [y, m] = colomboToday().split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const last = addDays(new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), -1);
  return { first, last };
}

/**
 * What caregivers are owed. A pay run makes a draft statement for everyone
 * who completed shifts in the period that are not on a statement yet; staff
 * check and adjust each one, approve it, then mark it paid once the money has
 * gone out.
 */
export default function PayoutsPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const [tab, setTab] = useState<PayoutStatus | 'all'>('DRAFT');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  useInitialParam('tab', TABS, setTab);
  const lm = lastMonth();
  const [periodStart, setPeriodStart] = useState(lm.first);
  const [periodEnd, setPeriodEnd] = useState(lm.last);
  const [single, setSingle] = useState(false);
  const generate = useGeneratePayouts();
  const create = useCreatePayout();

  useEffect(() => {
    if (!authLoading && user && !allowed) router.replace('/dashboard');
  }, [authLoading, user, allowed, router]);

  const { data: summary } = usePayoutSummary(allowed);
  const { data, isLoading } = usePayouts({ status: tab === 'all' ? undefined : tab, search: search.trim() || undefined, page, pageSize: 20 }, allowed);

  if (authLoading || !allowed) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  const periodOk = Boolean(periodStart && periodEnd && periodEnd >= periodStart);
  const err = generate.error ?? create.error;

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-ink">{t('billing.payouts.title')}</h1>
      <p className="mb-6 text-sm text-ink/60">{t('billing.payouts.subtitle')}</p>

      <Card className="mb-6">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('billing.payouts.runTitle')}</CardTitle>
          {summary && Number(summary.approvedTotal) > 0 && (
            <span className="text-sm text-ink/60">{t('billing.payouts.toPay', { amount: formatLkr(summary.approvedTotal), count: summary.byStatus.APPROVED })}</span>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="runFrom">{t('billing.newInvoice.from')}</Label>
              <Input id="runFrom" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="runTo">{t('billing.newInvoice.to')}</Label>
              <Input id="runTo" type="date" min={periodStart} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <Button disabled={!periodOk || generate.isPending} onClick={() => generate.mutate({ periodStart, periodEnd }, { onSuccess: () => setTab('DRAFT') })}>
              <Wallet size={16} aria-hidden />
              {t('billing.payouts.run')}
            </Button>
            <Button variant="secondary" onClick={() => setSingle((v) => !v)}>
              {t('billing.payouts.single')}
            </Button>
          </div>
          <p className="text-xs text-ink/50">{t('billing.payouts.runHint')}</p>
          {generate.data && (
            <p className="text-sm text-brand-dark" role="status">
              {generate.data.created ? t('billing.payouts.created', { count: generate.data.created }) : t('billing.payouts.nothingNew')}
            </p>
          )}
          {single && (
            <div className="max-w-md">
              <CaregiverPicker
                autoFocus
                onCancel={() => setSingle(false)}
                onPick={(c) => periodOk && create.mutate({ caregiverId: c.id, periodStart, periodEnd }, { onSuccess: (p) => router.push(`/payouts/${p.id}`) })}
              />
            </div>
          )}
          {err && (
            <p role="alert" className="text-sm text-danger">
              {err instanceof ApiError && err.message ? err.message : t('requests.detail.saveFailed')}
            </p>
          )}
        </CardContent>
      </Card>

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
            {t(`billing.payouts.tabs.${key}`)}
            {summary && key !== 'all' && <span className="rounded-full bg-paper px-1.5 text-xs tabular-nums text-ink/60">{summary.byStatus[key]}</span>}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <Input
          placeholder={t('billing.payouts.search')}
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('billing.payouts.table.reference')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.payouts.table.caregiver')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.payouts.table.period')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('billing.payouts.table.total')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.payouts.table.paidOn')}</th>
              <th className="px-4 py-3 font-medium">{t('billing.payouts.table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">{t('common.loading')}</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">{t('billing.payouts.empty')}</td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/payouts/${p.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {p.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{p.caregiverName}</div>
                  <div className="text-xs tabular-nums text-ink/50">{p.caregiverRegistrationNumber}</div>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {fmtDate(p.periodStart, locale)} – {fmtDate(p.periodEnd, locale)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">{formatLkr(p.total)}</td>
                <td className="px-4 py-3 text-ink/70">{p.paidOn ? fmtDate(p.paidOn, locale) : '—'}</td>
                <td className="px-4 py-3">
                  <PayoutStatusBadge status={p.status} label={t(`billing.payoutStatus.${p.status}`)} />
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
