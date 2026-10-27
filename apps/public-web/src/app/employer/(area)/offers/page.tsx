'use client';

import Link from 'next/link';
import { FileSignature } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate } from '@/lib/colombo-time';
import { formatMoney } from '@/lib/money';
import { useEmployerOffers } from '@/lib/hooks/use-international';
import { OfferStatusBadge } from '@/components/international/offer-terms';

/** Every job offer the employer has made, newest first. */
export default function EmployerOffersPage() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data = [], isLoading, isError } = useEmployerOffers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.offers.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('employer.offers.intro')}</p>
      </div>
      {isLoading && <div className="h-32 animate-pulse rounded-lg bg-white" aria-hidden />}
      {isError && <p className="text-sm text-danger">{t('portal.loadError')}</p>}
      {!isLoading && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
          <FileSignature className="mx-auto h-8 w-8 text-ink/30" aria-hidden />
          <p className="mt-2 text-sm text-ink/60">{t('employer.offers.empty')}</p>
          <Link href="/employer" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
            {t('employer.offers.emptyCta')}
          </Link>
        </div>
      )}
      {data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-white">
          {data.map((o) => (
            <li key={o.id}>
              <Link href={`/employer/offers/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-paper">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {o.talentFirstName} · {o.jobTitle}
                  </p>
                  <p className="text-xs text-ink/60">
                    {o.reference} · {o.enquiryReference} · {[o.city, countries.name(o.country)].filter(Boolean).join(', ')} ·{' '}
                    {t(`vacancies.per.${o.salaryPeriod}`, { amount: formatMoney(o.salaryAmount, o.salaryCurrency, locale) })}
                  </p>
                  {o.status === 'SENT' && o.expiresOn && !o.expired && <p className="text-xs text-brand-dark">{t('employer.offers.answerBy', { date: fmtDate(o.expiresOn, locale) })}</p>}
                  {o.status === 'RETURNED' && <p className="text-xs font-medium text-amber-800">{t('employer.offers.returnedHint')}</p>}
                </div>
                <OfferStatusBadge status={o.status} expired={o.expired} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
