'use client';

import { formatLkr, type ClientInvoice } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';

/**
 * An issued invoice as the client reads and prints it. The account layout
 * hides everything else in print, so "Print" - or "Save as PDF" in the print
 * dialog - gives a clean A4 invoice in the reader's own language and script.
 */
export function InvoiceView({ invoice }: { invoice: ClientInvoice }) {
  const { t, locale } = useTranslation();
  const s = invoice.seller;
  const taxed = Boolean(invoice.taxRate);
  const money = (v: string) => formatLkr(v).replace('LKR ', '');

  return (
    <article className="rounded-lg border border-border bg-white p-5 text-sm text-ink sm:p-8 print:border-0 print:p-0">
      {invoice.status === 'VOID' && <p className="mb-6 rounded border border-danger px-3 py-2 text-center font-semibold uppercase tracking-wide text-danger">{t('invoices.doc.void')}</p>}
      <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between print:flex-row">
        <div className="max-w-xs">
          <p className="text-lg font-semibold">{s.name}</p>
          {s.address && <p className="whitespace-pre-line text-ink/70">{s.address}</p>}
          <p className="text-ink/70">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
          {s.registrationNumber && <p className="text-ink/60">{t('invoices.doc.regNo', { number: s.registrationNumber })}</p>}
          {taxed && s.taxRegistrationNumber && <p className="text-ink/60">{t('invoices.doc.taxRegNo', { name: invoice.taxName ?? '', number: s.taxRegistrationNumber })}</p>}
        </div>
        <div className="sm:text-right print:text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-brand-dark">{taxed ? t('invoices.doc.taxInvoice') : t('invoices.doc.invoice')}</p>
          <p className="mt-1 text-base font-medium tabular-nums">{invoice.number}</p>
          <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-ink/70 sm:justify-end print:justify-end">
            <dt>{t('invoices.doc.issued')}</dt>
            <dd className="tabular-nums">{fmtDate(invoice.issueDate, locale)}</dd>
            <dt>{t('invoices.doc.due')}</dt>
            <dd className={invoice.overdue ? 'font-medium tabular-nums text-danger' : 'tabular-nums'}>{fmtDate(invoice.dueDate, locale)}</dd>
            {invoice.periodStart && invoice.periodEnd && (
              <>
                <dt>{t('invoices.doc.period')}</dt>
                <dd className="tabular-nums">
                  {fmtDate(invoice.periodStart, locale)} – {fmtDate(invoice.periodEnd, locale)}
                </dd>
              </>
            )}
            {invoice.bookingReference && (
              <>
                <dt>{t('invoices.doc.booking')}</dt>
                <dd className="tabular-nums">{invoice.bookingReference}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('invoices.doc.billTo')}</p>
        <p className="mt-1 font-semibold">{invoice.billTo.name}</p>
        {invoice.billTo.address && <p className="whitespace-pre-line text-ink/70">{invoice.billTo.address}</p>}
        <p className="text-ink/70">{[invoice.billTo.phone, invoice.billTo.email].filter(Boolean).join(' · ')}</p>
      </section>

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[480px] text-left">
          <thead className="border-b-2 border-ink/20 text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="py-2 pr-3 font-medium">{t('invoices.doc.date')}</th>
              <th className="py-2 pr-3 font-medium">{t('invoices.doc.description')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('invoices.doc.quantity')}</th>
              <th className="py-2 pr-3 text-right font-medium">{t('invoices.doc.price')}</th>
              <th className="py-2 text-right font-medium">{t('invoices.doc.amount')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoice.lines.map((l, i) => (
              <tr key={i} className="break-inside-avoid align-top">
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-ink/70">{l.serviceDate ? fmtDate(l.serviceDate, locale) : ''}</td>
                <td className="py-2 pr-3">
                  {l.description}
                  {Number(l.discount) > 0 && <span className="block text-xs text-ink/50">{t('invoices.doc.lineDiscount', { amount: formatLkr(l.discount) })}</span>}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                  {Number(l.quantity)} {t(`invoices.unit.${l.unit}`)}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{money(l.unitPrice)}</td>
                <td className="whitespace-nowrap py-2 text-right tabular-nums">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-6 w-full max-w-xs break-inside-avoid border-t border-border pt-4">
        <Row label={t('invoices.doc.subtotal')} value={formatLkr(invoice.subtotal)} />
        {Number(invoice.discount) > 0 && (
          <Row label={invoice.discountLabel ? `${t('invoices.doc.discount')} (${invoice.discountLabel})` : t('invoices.doc.discount')} value={`−${formatLkr(invoice.discount)}`} />
        )}
        {taxed && <Row label={`${invoice.taxName} ${Number(invoice.taxRate)}%`} value={formatLkr(invoice.tax)} />}
        <Row label={t('invoices.doc.total')} value={formatLkr(invoice.total)} strong />
        {Number(invoice.amountPaid) !== 0 && <Row label={t('invoices.doc.paid')} value={`−${formatLkr(invoice.amountPaid)}`} />}
        {Number(invoice.amountPaid) !== 0 && <Row label={t('invoices.doc.balance')} value={formatLkr(invoice.balance)} strong />}
      </dl>

      {invoice.status === 'PAID' && <p className="mt-4 text-right text-base font-semibold uppercase tracking-wide text-brand-dark">{t('invoices.doc.paidInFull')}</p>}
      {invoice.payments.length > 0 && (
        <section className="mt-6 break-inside-avoid">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('invoices.doc.payments')}</p>
          <ul className="mt-1 text-ink/70">
            {invoice.payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-3 tabular-nums">
                <span>
                  {fmtDate(p.paidOn, locale)} · {t(`invoices.method.${p.method}`)}
                  {p.reference && ` · ${p.reference}`}
                </span>
                <span>{formatLkr(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {invoice.notes && <p className="mt-8 whitespace-pre-line text-ink/80">{invoice.notes}</p>}
      {invoice.footer && <footer className="mt-8 whitespace-pre-line border-t border-border pt-4 text-xs text-ink/60">{invoice.footer}</footer>}
    </article>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 py-1 ${strong ? 'border-t border-border pt-2 text-base font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-ink/60'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
