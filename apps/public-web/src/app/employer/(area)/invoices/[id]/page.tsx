'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronLeft, CreditCard, Loader2, Printer } from 'lucide-react';
import type { PayhereCheckout, PlacementInvoice } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { fmtDate } from '@/lib/colombo-time';
import { formatMoney } from '@/lib/money';
import { useEmployerInvoice, usePayInvoice } from '@/lib/hooks/use-international';

/** Hands the browser to PayHere: a plain form post, the way its checkout expects. */
function postToPayhere({ action, fields }: PayhereCheckout) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/**
 * A placement-fee invoice: read it, print it (or save it as PDF), and pay it
 * by card when its currency allows - otherwise by bank transfer, with the
 * details printed on it. Coming back from PayHere, the page waits for
 * PayHere's own confirmation rather than trusting the return.
 */
function EmployerInvoicePage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const payment = useSearchParams().get('payment');
  const { data: invoice, isLoading, isError } = useEmployerInvoice(id, payment === 'return');
  const pay = usePayInvoice(id);
  const [redirecting, setRedirecting] = useState(false);

  if (isLoading) return <div className="h-96 animate-pulse rounded-lg bg-white" aria-hidden />;
  if (isError || !invoice) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm text-ink/60">{t('employer.invoices.notFound')}</p>
        <Link href="/employer/placements" className="mt-3 inline-block text-sm font-semibold text-brand">
          {t('employer.nav.placements')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/employer/placements" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
          <ChevronLeft size={16} aria-hidden />
          {t('employer.nav.placements')}
        </Link>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded border border-border bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
          <Printer size={16} aria-hidden />
          {t('invoices.print')}
        </button>
      </div>

      {payment === 'return' && (
        <p role="status" className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm print:hidden ${invoice.status === 'PAID' ? 'bg-brand-light text-brand-dark' : 'bg-white text-ink/70'}`}>
          {invoice.status === 'PAID' ? (
            t('invoices.pay.thanks')
          ) : (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden />
              {t('invoices.pay.confirming')}
            </>
          )}
        </p>
      )}
      {payment === 'cancelled' && invoice.status === 'ISSUED' && <p className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-ink/70 print:hidden">{t('invoices.pay.cancelled')}</p>}

      {invoice.payOnline && (
        <section className="mb-4 rounded-lg border border-brand/30 bg-white p-4 print:hidden sm:p-5" aria-labelledby="pay-online">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="pay-online" className="text-base font-semibold text-ink">
                {t('invoices.pay.title', { amount: formatMoney(invoice.balance, invoice.currency, locale) })}
              </h2>
              <p className="text-sm text-ink/60">{t('employer.invoices.payHint')}</p>
            </div>
            <button
              type="button"
              disabled={pay.isPending || redirecting}
              onClick={() =>
                pay.mutate(undefined, {
                  onSuccess: (checkout) => {
                    setRedirecting(true);
                    postToPayhere(checkout);
                  },
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark disabled:pointer-events-none disabled:opacity-50"
            >
              {pay.isPending || redirecting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CreditCard size={16} aria-hidden />}
              {redirecting ? t('invoices.pay.redirecting') : t('invoices.pay.button')}
            </button>
          </div>
          {pay.isError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {pay.error instanceof ApiError && pay.error.message ? pay.error.message : t('invoices.pay.error')}
            </p>
          )}
        </section>
      )}
      {invoice.status === 'ISSUED' && !invoice.payOnline && <p className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-ink/70 print:hidden">{t('invoices.pay.offline')}</p>}

      <PlacementInvoiceView invoice={invoice} />
    </div>
  );
}

function PlacementInvoiceView({ invoice: i }: { invoice: PlacementInvoice }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const money = (v: string) => formatMoney(v, i.currency, locale);
  const s = i.seller;

  return (
    <article className="rounded-lg border border-border bg-white p-5 text-sm text-ink sm:p-8 print:border-0 print:p-0">
      {i.status === 'VOID' && <p className="mb-6 rounded border border-danger px-3 py-2 text-center font-semibold uppercase tracking-wide text-danger">{t('invoices.doc.void')}</p>}
      <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between print:flex-row">
        <div className="max-w-xs">
          <p className="text-lg font-semibold">{s.name}</p>
          {s.address && <p className="whitespace-pre-line text-ink/70">{s.address}</p>}
          <p className="text-ink/70">{[s.phone, s.email].filter(Boolean).join(' · ')}</p>
          {s.registrationNumber && <p className="text-ink/60">{t('invoices.doc.regNo', { number: s.registrationNumber })}</p>}
        </div>
        <div className="sm:text-right print:text-right">
          <p className="text-2xl font-semibold uppercase tracking-wide text-brand-dark">{t('invoices.doc.invoice')}</p>
          <p className="mt-1 text-base font-medium tabular-nums">{i.number}</p>
          <dl className="mt-3 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-ink/70 sm:justify-end print:justify-end">
            {i.issueDate && (
              <>
                <dt>{t('invoices.doc.issued')}</dt>
                <dd className="tabular-nums">{fmtDate(i.issueDate, locale)}</dd>
              </>
            )}
            {i.dueDate && (
              <>
                <dt>{t('invoices.doc.due')}</dt>
                <dd className={i.overdue ? 'font-medium tabular-nums text-danger' : 'tabular-nums'}>{fmtDate(i.dueDate, locale)}</dd>
              </>
            )}
            <dt>{t('employer.invoices.enquiry')}</dt>
            <dd className="tabular-nums">{i.enquiryReference}</dd>
          </dl>
        </div>
      </header>

      <section className="py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('invoices.doc.billTo')}</p>
        <p className="mt-1 font-semibold">{i.billToName}</p>
        {i.billToAddress && <p className="whitespace-pre-line text-ink/70">{i.billToAddress}</p>}
        <p className="text-ink/70">{[i.billToCountry ? countries.name(i.billToCountry) : null, i.billToEmail].filter(Boolean).join(' · ')}</p>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink/20 text-left text-xs uppercase tracking-wide text-ink/50">
            <th className="py-2 font-semibold">{t('invoices.doc.description')}</th>
            <th className="py-2 text-right font-semibold">{t('invoices.doc.amount')}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-3">{i.description}</td>
            <td className="py-3 text-right tabular-nums">{money(i.amount)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 text-right font-semibold">{t('invoices.doc.total')}</td>
            <td className="pt-3 text-right font-semibold tabular-nums">{money(i.amount)}</td>
          </tr>
          {Number(i.amountPaid) !== 0 && (
            <tr>
              <td className="pt-1 text-right text-ink/70">{t('invoices.doc.paid')}</td>
              <td className="pt-1 text-right tabular-nums text-ink/70">{money(i.amountPaid)}</td>
            </tr>
          )}
          {i.status !== 'VOID' && (
            <tr>
              <td className="pt-1 text-right font-semibold">{t('invoices.doc.balance')}</td>
              <td className="pt-1 text-right font-semibold tabular-nums">{money(i.balance)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {i.status === 'PAID' && <p className="mt-6 rounded bg-brand-light px-3 py-2 text-center font-medium text-brand-dark">{t('invoices.doc.paidInFull')}</p>}
      {i.payments.length > 0 && (
        <section className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('invoices.doc.payments')}</p>
          <ul className="mt-2 space-y-1 text-ink/70">
            {i.payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 tabular-nums">
                <span>
                  {fmtDate(p.paidOn, locale)} · {t(`employer.invoices.method.${p.method}`)}
                  {p.reference ? ` · ${p.reference}` : ''}
                </span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {i.notes && <p className="mt-6 whitespace-pre-line text-ink/80">{i.notes}</p>}
      <p className="mt-6 text-xs text-ink/60">{t('employer.invoices.feeTerms')}</p>
      {i.footer && <p className="mt-6 whitespace-pre-line border-t border-border pt-4 text-xs text-ink/60">{i.footer}</p>}
    </article>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function EmployerInvoicePageWrapper() {
  return (
    <Suspense>
      <EmployerInvoicePage />
    </Suspense>
  );
}
