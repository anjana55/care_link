'use client';

import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { formatLkr, type PayableInvoice } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';

/**
 * "Pay now" for an invoice a booking is waiting for. It opens the invoice
 * with the online payment started (\`?pay=1\`), so the same tested PayHere
 * flow - and its return and confirmation handling - is used everywhere.
 * When online payment is not offered it opens the invoice, which says how
 * to pay instead.
 */
export function PayNow({ invoice, why }: { invoice: PayableInvoice; why: string }) {
  const { t, locale } = useTranslation();
  if (Number(invoice.balance) <= 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded border border-brand/30 bg-white px-3 py-2" data-testid={`pay-${invoice.id}`}>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-ink">{t('payNow.amount', { amount: formatLkr(invoice.balance), number: invoice.number ?? '' })}</p>
        <p className="text-xs text-ink/60">
          {why}
          {invoice.dueDate && ` ${t('payNow.due', { date: fmtDate(invoice.dueDate, locale) })}`}
        </p>
      </div>
      {invoice.canPayOnline ? (
        <Link
          href={`/account/invoices/${invoice.id}?pay=1`}
          className="inline-flex h-10 items-center gap-2 rounded bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark"
        >
          <CreditCard size={16} aria-hidden />
          {t('payNow.button')}
        </Link>
      ) : (
        <Link href={`/account/invoices/${invoice.id}`} className="text-sm font-medium text-brand hover:underline">
          {t('payNow.view')}
        </Link>
      )}
    </div>
  );
}
