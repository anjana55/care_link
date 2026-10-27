'use client';

import Link from 'next/link';
import { FileText, ShieldCheck } from 'lucide-react';
import type { EmployerPlacement, PlacementInvoiceSummary } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate } from '@/lib/colombo-time';
import { formatMoney } from '@/lib/money';
import { useEmployerInvoices, useEmployerPlacements } from '@/lib/hooks/use-international';
import { TalentPhoto } from '@/components/international/talent-card';
import { cn } from '@/lib/utils';

/**
 * Caregivers the employer has hired through us, and the placement-fee
 * invoices. Welfare follow-up after arrival is our team's job; the employer
 * sees where each placement stands and until when the replacement guarantee
 * runs.
 */
export default function EmployerPlacementsPage() {
  const { t, locale } = useTranslation();
  const { data: placements = [], isLoading } = useEmployerPlacements(locale);
  const { data: invoices = [] } = useEmployerInvoices();
  const onPlacements = new Set(placements.flatMap((p) => p.invoices.map((i) => i.id)));
  const other = invoices.filter((i) => !onPlacements.has(i.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.placements.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink/60">{t('employer.placements.intro')}</p>
      </div>
      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-white" aria-hidden />}
      {!isLoading && placements.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-ink/60">{t('employer.placements.empty')}</p>
      )}
      <ul className="space-y-4">
        {placements.map((p) => (
          <PlacementRow key={p.id} placement={p} />
        ))}
      </ul>
      {other.length > 0 && (
        <section aria-labelledby="other-invoices" className="rounded-lg border border-border bg-white">
          <h2 id="other-invoices" className="border-b border-border px-5 py-3 text-sm font-semibold text-ink">
            {t('employer.placements.otherInvoices')}
          </h2>
          <InvoiceList invoices={other} />
        </section>
      )}
    </div>
  );
}

function PlacementRow({ placement: p }: { placement: EmployerPlacement }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const facts: [string, string | null][] = [
    ['departure', p.departureOn],
    ['arrived', p.arrivedOn],
    ['contractStart', p.contractStartOn],
    ['contractEnd', p.contractEndsOn],
  ];
  return (
    <li className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <TalentPhoto photoUrl={p.talent.photoUrl} firstName={p.talent.firstName} className="h-14 w-14 shrink-0 text-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {p.talent.slug ? (
              <Link href={`/talent/${p.talent.slug}`} className="font-semibold text-ink hover:text-brand-dark hover:underline">
                {p.talent.firstName}
              </Link>
            ) : (
              <span className="font-semibold text-ink">{p.talent.firstName}</span>
            )}
            <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-dark">{t(`employer.placements.status.${p.status}`)}</span>
          </div>
          <p className="text-sm text-ink/60">
            {[p.jobTitle, countries.name(p.country)].filter(Boolean).join(' · ')} · {p.enquiryReference}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {facts.map(([key, d]) => (
              <div key={key}>
                <dt className="text-xs text-ink/50">{t(`portal.workAbroad.placement.${key}`)}</dt>
                <dd className="tabular-nums text-ink">{d ? fmtDate(d, locale) : '-'}</dd>
              </div>
            ))}
          </dl>
          {p.guaranteeEndsOn && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink/60">
              <ShieldCheck className="h-4 w-4 text-brand" aria-hidden />
              {t('employer.placements.guarantee', { date: fmtDate(p.guaranteeEndsOn, locale) })}
            </p>
          )}
        </div>
      </div>
      {p.invoices.length > 0 && <InvoiceList invoices={p.invoices} />}
    </li>
  );
}

function InvoiceList({ invoices }: { invoices: PlacementInvoiceSummary[] }) {
  const { t, locale } = useTranslation();
  return (
    <ul className="divide-y divide-border border-t border-border">
      {invoices.map((i) => (
        <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <Link href={`/employer/invoices/${i.id}`} className="inline-flex items-center gap-2 font-medium text-brand hover:text-brand-dark">
            <FileText className="h-4 w-4" aria-hidden />
            {t('employer.invoices.label', { number: i.number ?? '' })}
          </Link>
          <span className="flex items-center gap-3">
            <span className="tabular-nums text-ink">{formatMoney(i.amount, i.currency, locale)}</span>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                i.status === 'PAID' ? 'bg-brand-light text-brand-dark' : i.overdue ? 'bg-red-100 text-red-800' : i.status === 'VOID' ? 'bg-ink/10 text-ink/60' : 'bg-accent-light text-accent-dark',
              )}
            >
              {i.overdue ? t('employer.invoices.overdue') : t(`employer.invoices.status.${i.status}`)}
            </span>
            {i.dueDate && i.status === 'ISSUED' && <span className="text-xs text-ink/50">{t('employer.invoices.due', { date: fmtDate(i.dueDate, locale) })}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
