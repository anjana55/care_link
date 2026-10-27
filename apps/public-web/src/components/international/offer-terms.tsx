'use client';

import type { OfferSignature, OfferStatus, OfferTerms } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate, fmtDateTime } from '@/lib/colombo-time';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<OfferStatus, string> = {
  PENDING_REVIEW: 'bg-accent-light text-accent-dark',
  RETURNED: 'bg-amber-100 text-amber-900',
  SENT: 'bg-brand-light text-brand-dark',
  ACCEPTED: 'bg-brand text-white',
  DECLINED: 'bg-ink/10 text-ink/70',
  WITHDRAWN: 'bg-ink/10 text-ink/60',
};

export function OfferStatusBadge({ status, expired }: { status: OfferStatus; expired?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', expired ? 'bg-red-100 text-red-800' : STATUS_STYLE[status])}>
      {expired ? t('overseas.offerStatus.EXPIRED') : t(`overseas.offerStatus.${status}`)}
    </span>
  );
}

/** The terms of a job offer, in the same order on every screen and on paper. */
export function OfferTermsList({ terms }: { terms: OfferTerms }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const salary = t(`vacancies.per.${terms.salaryPeriod}`, { amount: formatMoney(terms.salaryAmount, terms.salaryCurrency, locale) });
  const rows: [string, string][] = [
    [t('overseas.terms.jobTitle'), terms.jobTitle],
    [t('overseas.terms.location'), [terms.city, countries.name(terms.country)].filter(Boolean).join(', ')],
    [t('overseas.terms.startDate'), terms.startDate ? fmtDate(terms.startDate, locale) : t('overseas.terms.startTbc')],
    [t('overseas.terms.contract'), t('overseas.terms.months', { n: terms.contractMonths })],
    [t('overseas.terms.hours'), t('overseas.terms.hoursValue', { n: terms.hoursPerWeek })],
    [t('overseas.terms.salary'), salary],
    [t('overseas.terms.accommodation'), t(`overseas.accommodation.${terms.accommodation}`)],
    [t('overseas.terms.meals'), terms.mealsProvided ? t('overseas.terms.yes') : t('overseas.terms.no')],
    [t('overseas.terms.flights'), t(`overseas.flights.${terms.flightsPaidBy}`)],
    ...(terms.annualLeaveDays !== null ? ([[t('overseas.terms.leave'), t('overseas.terms.days', { n: terms.annualLeaveDays })]] as [string, string][]) : []),
    ...(terms.probationMonths !== null ? ([[t('overseas.terms.probation'), t('overseas.terms.months', { n: terms.probationMonths })]] as [string, string][]) : []),
  ];
  return (
    <div>
      <dl className="divide-y divide-border rounded border border-border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2">
            <dt className="text-ink/60">{label}</dt>
            <dd className="font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {terms.otherTerms && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('overseas.terms.other')}</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink/80">{terms.otherTerms}</p>
        </div>
      )}
    </div>
  );
}

/** "Signed by Aiko Tanaka, 27 Oct 2026, 10:14": a typed signature and when it was given. */
export function SignatureLine({ label, signature }: { label: string; signature: OfferSignature | null }) {
  const { t, locale } = useTranslation();
  return (
    <div className="rounded border border-dashed border-border px-3 py-2">
      <p className="text-xs text-ink/50">{label}</p>
      {signature ? (
        <p className="mt-0.5 text-sm">
          <span className="font-serif text-lg italic text-ink">{signature.name}</span>
          <span className="ml-2 text-xs text-ink/50">{t('overseas.signedOn', { when: fmtDateTime(signature.signedAt, locale) })}</span>
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-ink/40">{t('overseas.notSigned')}</p>
      )}
    </div>
  );
}
