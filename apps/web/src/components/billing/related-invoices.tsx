'use client';

import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useInvoices } from '@/lib/hooks/use-billing';
import { fmtDate } from '@/lib/colombo-time';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InvoiceStatusBadge, OverdueBadge } from './billing-badges';

/** The invoices for one booking or one client, with a shortcut to bill them. */
export function RelatedInvoices({ bookingId, patientId, canCreate = true }: { bookingId?: string; patientId?: string; canCreate?: boolean }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useInvoices({ bookingId, patientId, pageSize: 10 });
  const newHref = `/invoices/new?${bookingId ? `bookingId=${bookingId}` : `patientId=${patientId}`}`;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('billing.related.title')}</CardTitle>
        {canCreate && (
          <Link href={newHref} className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
            <FilePlus2 size={12} aria-hidden />
            {t('billing.related.create')}
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {data && data.items.length === 0 && <p className="text-sm text-ink/50">{t('billing.related.empty')}</p>}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {data.items.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link href={`/invoices/${inv.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {inv.number ?? t('billing.invoices.draftNumber')}
                  </Link>
                  <span className="ml-2 text-xs text-ink/50">
                    {inv.periodStart && inv.periodEnd ? `${fmtDate(inv.periodStart, locale)} – ${fmtDate(inv.periodEnd, locale)}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums text-ink/70">{formatLkr(inv.total)}</span>
                  <InvoiceStatusBadge status={inv.status} label={t(`billing.invoiceStatus.${inv.status}`)} />
                  {inv.overdue && <OverdueBadge label={t('billing.overdue')} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
