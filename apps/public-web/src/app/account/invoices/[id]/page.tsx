'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ChevronLeft, CreditCard, Loader2, Printer } from 'lucide-react';
import { formatLkr, type PayhereCheckout } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useMyInvoice, useStartOnlinePayment } from '@/lib/hooks/use-client-care';
import { LoadingState, ErrorState } from '@/components/common/states';
import { InvoiceView } from '@/components/care/invoice-view';

/** Hands the browser to PayHere: a plain form post, the way PayHere's checkout expects. */
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
 * One invoice: read it, print it (or save it as a PDF), and pay the balance
 * online when the agency offers it. Coming back from PayHere, the page waits
 * for PayHere's own confirmation to reach us rather than trusting the return.
 */
function InvoicePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const payment = params.get('payment');
  const { user } = useAuth();
  const { data: invoice, isLoading, isError, refetch } = useMyInvoice(id, payment === 'return');
  const start = useStartOnlinePayment(id);
  const [email, setEmail] = useState('');
  const [redirecting, setRedirecting] = useState(false);

  if (isLoading) return <LoadingState label={t('common.loading')} />;
  if (isError || !invoice) {
    return (
      <div>
        <ErrorState onRetry={() => refetch()} />
        <Link href="/account/invoices" className="mt-4 inline-block text-sm text-brand hover:underline">
          {t('invoices.back')}
        </Link>
      </div>
    );
  }

  const needEmail = !user?.email && !invoice.billTo.email;
  const emailOk = !needEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pay = () =>
    start.mutate(needEmail ? email.trim() : undefined, {
      onSuccess: (checkout) => {
        setRedirecting(true);
        postToPayhere(checkout);
      },
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/account/invoices" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
          <ChevronLeft size={16} aria-hidden />
          {t('invoices.back')}
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded border border-border bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
        >
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

      {invoice.canPayOnline && (
        <section className="mb-4 rounded-lg border border-brand/30 bg-white p-4 print:hidden sm:p-5" aria-labelledby="pay-online">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="pay-online" className="text-base font-semibold text-ink">
                {t('invoices.pay.title', { amount: formatLkr(invoice.balance) })}
              </h2>
              <p className="text-sm text-ink/60">{t('invoices.pay.hint')}</p>
            </div>
            <button
              type="button"
              disabled={!emailOk || start.isPending || redirecting}
              onClick={pay}
              className="inline-flex h-10 items-center gap-2 rounded bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark disabled:pointer-events-none disabled:opacity-50"
            >
              {start.isPending || redirecting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CreditCard size={16} aria-hidden />}
              {redirecting ? t('invoices.pay.redirecting') : t('invoices.pay.button')}
            </button>
          </div>
          {needEmail && (
            <div className="mt-3 max-w-sm">
              <label htmlFor="receiptEmail" className="mb-1 block text-sm font-medium text-ink">
                {t('invoices.pay.email')}
              </label>
              <input
                id="receiptEmail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-10 w-full rounded border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <p className="mt-1 text-xs text-ink/50">{t('invoices.pay.emailHint')}</p>
            </div>
          )}
          {start.isError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {start.error instanceof ApiError && start.error.message ? start.error.message : t('invoices.pay.error')}
            </p>
          )}
        </section>
      )}
      {invoice.status === 'ISSUED' && !invoice.canPayOnline && <p className="mb-4 rounded-lg bg-white px-4 py-3 text-sm text-ink/70 print:hidden">{t('invoices.pay.offline')}</p>}

      <InvoiceView invoice={invoice} />
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function InvoicePageWrapper() {
  return (
    <Suspense>
      <InvoicePage />
    </Suspense>
  );
}
