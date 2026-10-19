'use client';

import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDate } from '@/lib/colombo-time';
import type { InvoiceDetail } from '@/lib/api/types';
import { TotalsBlock } from './line-editor';

/**
 * The invoice as the client receives it - what Print (and "Save as PDF" in the
 * print dialog) produces. Everything around it on the page is hidden in print.
 * The browser lays the text out, so Sinhala and Tamil print in the fonts the
 * page already uses, with no PDF font set-up.
 */
export function InvoiceDocument({ invoice }: { invoice: InvoiceDetail }) {
  const { t, locale } = useTranslation();
  const s = invoice.seller;
  const taxed = Boolean(invoice.taxRate);
  const discountLabel = [invoice.discountType === 'PERCENT' ? `${Number(invoice.discountValue)}%` : null, invoice.discountReason].filter(Boolean).join(' · ') || null;

  return (
    <article className="relative mx-auto max-w-[210mm] bg-white p-8 text-sm text-ink shadow-sm print:max-w-none print:p-0 print:shadow-none sm:p-10">
      {invoice.status === 'DRAFT' && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
          <span className="-rotate-12 select-none text-[110px] font-bold uppercase tracking-widest text-ink/[0.05]">{t('billing.doc.draft')}</span>
        </div>
      )}
      {invoice.status === 'VOID' && (
        <p className="mb-6 rounded border border-danger px-3 py-2 text-center font-semibold uppercase tracking-wide text-danger">{t('billing.doc.void')}</p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
        <div className="max-w-xs">
          <p className="text-lg font-semibold">{s.name}</p>
          {s.address && <p className="whitespace-pre-line text-ink/70">{s.address}</p>}
          <p className="text-ink/70">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
          {s.registrationNumber && <p className="text-ink/60">{t('billing.doc.regNo', { number: s.registrationNumber })}</p>}
          {taxed && s.taxRegistrationNumber && <p className="text-ink/60">{t('billing.doc.taxRegNo', { name: invoice.taxName ?? '', number: s.taxRegistrationNumber })}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-brand-dark">{taxed ? t('billing.doc.taxInvoice') : t('billing.doc.invoice')}</p>
          <p className="mt-1 text-base font-medium tabular-nums">{invoice.number ?? t('billing.doc.notNumbered')}</p>
          <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-ink/70">
            <dt>{t('billing.doc.issued')}</dt>
            <dd className="tabular-nums">{invoice.issueDate ? fmtDate(invoice.issueDate, locale) : '—'}</dd>
            <dt>{t('billing.doc.due')}</dt>
            <dd className="tabular-nums">{invoice.dueDate ? fmtDate(invoice.dueDate, locale) : '—'}</dd>
            {invoice.periodStart && invoice.periodEnd && (
              <>
                <dt>{t('billing.doc.period')}</dt>
                <dd className="tabular-nums">
                  {fmtDate(invoice.periodStart, locale)} – {fmtDate(invoice.periodEnd, locale)}
                </dd>
              </>
            )}
            {invoice.booking && (
              <>
                <dt>{t('billing.doc.booking')}</dt>
                <dd className="tabular-nums">{invoice.booking.reference}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('billing.doc.billTo')}</p>
        <p className="mt-1 font-semibold">{invoice.billToName}</p>
        {invoice.billToAddress && <p className="whitespace-pre-line text-ink/70">{invoice.billToAddress}</p>}
        <p className="text-ink/70">{[invoice.billToPhone, invoice.billToEmail].filter(Boolean).join(' · ')}</p>
      </section>

      <table className="w-full text-left">
        <thead className="border-b-2 border-ink/20 text-xs uppercase tracking-wide text-ink/50">
          <tr>
            <th className="py-2 pr-3 font-medium">{t('billing.lines.date')}</th>
            <th className="py-2 pr-3 font-medium">{t('billing.lines.description')}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('billing.lines.quantity')}</th>
            <th className="py-2 pr-3 text-right font-medium">{t('billing.lines.price')}</th>
            <th className="py-2 text-right font-medium">{t('billing.lines.amount')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoice.lines.map((l) => (
            <tr key={l.id} className="break-inside-avoid align-top">
              <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-ink/70">{l.serviceDate ? fmtDate(l.serviceDate, locale) : ''}</td>
              <td className="py-2 pr-3">
                {l.description}
                {Number(l.discount) > 0 && (
                  <span className="block text-xs text-ink/50">
                    {t('billing.doc.lineDiscount', { amount: formatLkr(l.discount) })}
                    {l.discountType === 'PERCENT' && ` (${Number(l.discountValue)}%)`}
                  </span>
                )}
                {taxed && l.taxable === false && <span className="block text-xs text-ink/50">{t('billing.doc.noTax')}</span>}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                {Number(l.quantity)} {t(`billing.unitShort.${l.unit}`)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{formatLkr(l.unitPrice).replace('LKR ', '')}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatLkr(l.amount).replace('LKR ', '')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 break-inside-avoid border-t border-border pt-4">
        <TotalsBlock
          totals={{ subtotal: invoice.subtotal, discount: invoice.discountAmount, tax: invoice.taxAmount, total: invoice.total }}
          discountLabel={discountLabel}
          taxLabel={taxed ? `${invoice.taxName} ${Number(invoice.taxRate)}%` : null}
          paid={invoice.status === 'DRAFT' ? undefined : invoice.amountPaid}
          balance={invoice.status === 'DRAFT' ? undefined : invoice.balance}
        />
      </div>

      {invoice.status === 'PAID' && <p className="mt-4 text-right text-base font-semibold uppercase tracking-wide text-brand-dark">{t('billing.doc.paidInFull')}</p>}
      {invoice.notes && <p className="mt-8 whitespace-pre-line text-ink/80">{invoice.notes}</p>}
      {invoice.footer && <footer className="mt-8 whitespace-pre-line border-t border-border pt-4 text-xs text-ink/60">{invoice.footer}</footer>}
    </article>
  );
}
