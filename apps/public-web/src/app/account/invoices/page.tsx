'use client';

import Link from 'next/link';
import { formatLkr, type ClientInvoice } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useMyInvoices } from '@/lib/hooks/use-client-care';
import { fmtDate } from '@/lib/colombo-time';
import { LoadingState, ErrorState } from '@/components/common/states';

const TONE: Record<ClientInvoice['status'], string> = {
  ISSUED: 'bg-accent-light text-accent',
  PAID: 'bg-brand-light text-brand-dark',
  VOID: 'bg-paper text-ink/50',
};

/** The client's invoices, unpaid first, each opening the full invoice to read, print or pay. */
export default function MyInvoicesPage() {
  const { t, locale } = useTranslation();
  const { data, isLoading, isError, refetch } = useMyInvoices();
  const sorted = data ? [...data].sort((a, b) => Number(b.status === 'ISSUED') - Number(a.status === 'ISSUED')) : [];
  const owing = (data ?? []).filter((i) => i.status === 'ISSUED').reduce((sum, i) => sum + Number(i.balance), 0);

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{t('invoices.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('invoices.subtitle')}</p>
      {owing > 0 && (
        <p className="mt-4 rounded-lg border border-border bg-white px-4 py-3 text-sm">
          {t('invoices.owing')} <span className="font-semibold tabular-nums text-ink">{formatLkr(owing.toFixed(2))}</span>
        </p>
      )}
      <div className="mt-6">
        {isLoading && <LoadingState label={t('common.loading')} />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink/60">{t('invoices.empty')}</p>
          </div>
        )}
        {sorted.length > 0 && (
          <ul className="space-y-3">
            {sorted.map((inv) => (
              <li key={inv.id}>
                <Link href={`/account/invoices/${inv.id}`} className="block rounded-lg border border-border bg-white p-4 transition-colors hover:border-brand sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium tabular-nums text-ink">{inv.number}</p>
                      <p className="text-xs text-ink/50">
                        {inv.periodStart && inv.periodEnd
                          ? `${fmtDate(inv.periodStart, locale)} – ${fmtDate(inv.periodEnd, locale)}`
                          : t('invoices.issuedOn', { date: fmtDate(inv.issueDate, locale) })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {inv.overdue && <span className="rounded-full bg-danger-light px-2.5 py-0.5 text-xs font-medium text-danger">{t('invoices.overdue')}</span>}
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[inv.status]}`}>{t(`invoices.status.${inv.status}`)}</span>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-ink/50">{t('invoices.total')}</dt>
                      <dd className="tabular-nums text-ink">{formatLkr(inv.total)}</dd>
                    </div>
                    {inv.status === 'ISSUED' && (
                      <div>
                        <dt className="text-xs text-ink/50">{t('invoices.balance')}</dt>
                        <dd className="font-medium tabular-nums text-ink">{formatLkr(inv.balance)}</dd>
                      </div>
                    )}
                    {inv.status === 'ISSUED' && (
                      <div>
                        <dt className="text-xs text-ink/50">{t('invoices.due')}</dt>
                        <dd className={inv.overdue ? 'font-medium text-danger' : 'text-ink'}>{fmtDate(inv.dueDate, locale)}</dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
