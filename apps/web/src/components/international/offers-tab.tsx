'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { OfferStatus, OfferTerms, StaffJobOffer } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useReviewOffer, useStaffOffers } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DeleteRecordButton } from '@/components/overseas-admin/delete-record-button';
import { countryName, day, money } from './shared';

export const OFFER_STYLES: Record<OfferStatus, string> = {
  PENDING_REVIEW: 'bg-accent text-white',
  RETURNED: 'bg-amber-100 text-amber-900',
  SENT: 'bg-brand-light text-brand-dark',
  ACCEPTED: 'bg-brand text-white',
  DECLINED: 'bg-ink/10 text-ink/70',
  WITHDRAWN: 'bg-ink/10 text-ink/50',
};

const FILTERS = ['PENDING_REVIEW', 'open', 'SENT', 'ACCEPTED', 'DECLINED', 'RETURNED', 'WITHDRAWN', 'all'] as const;

/**
 * Job offers from employers. Every offer stops here before the caregiver sees
 * it: staff read the terms, and send it on or return it with a note. The
 * caregiver's answer comes back here too.
 */
export function OffersTab() {
  const { t } = useTranslation();
  const [focus, setFocus] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING_REVIEW');
  // Opened from a candidate (?offer=...): show every offer, with that one open.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('offer');
    if (id) {
      setFocus(id);
      setFilter('all');
    }
  }, []);
  const { data = [], isLoading } = useStaffOffers(filter === 'all' ? '' : filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.offers.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.offers.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.offers.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.offers.empty')}</p>}
      <ul className="space-y-2">
        {data.map((o) => (
          <OfferRow key={`${o.id}-${focus}`} offer={o} initiallyOpen={o.id === focus || (o.status === 'PENDING_REVIEW' && data.length <= 3)} />
        ))}
      </ul>
    </div>
  );
}

function OfferRow({ offer: o, initiallyOpen }: { offer: StaffJobOffer; initiallyOpen: boolean }) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const review = useReviewOffer();
  const [note, setNote] = useState('');

  return (
    <li className="rounded-lg border border-border bg-white">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="font-medium text-ink">{o.fullName}</span>
        <span className="text-xs tabular-nums text-ink/50">{o.registrationNumber}</span>
        <span className="text-sm text-ink/70">
          {o.organisationName} · {o.jobTitle} · {countryName(o.country, locale)}
        </span>
        <span className="text-xs tabular-nums text-ink/50">{o.reference}</span>
        <span className={cn('ml-auto rounded px-2 py-0.5 text-xs font-medium', o.expired ? 'bg-danger/10 text-danger' : OFFER_STYLES[o.status])}>
          {o.expired ? t('international.offers.expired') : t(`international.offers.status.${o.status}`)}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <TermsTable terms={o} />
          {o.status !== 'ACCEPTED' && (
            <div className="flex justify-end">
              <DeleteRecordButton path={`/international/offers/${o.id}`} title={t('overseasAdmin.offer.deleteTitle', { reference: o.reference })} body={t('overseasAdmin.offer.deleteBody')} />
            </div>
          )}
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <Signature label={t('international.offers.employerSigned')} signature={o.employerSignature} />
            <Signature label={t('international.offers.caregiverSigned')} signature={o.caregiverSignature} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/50">
            <Link href={`/international/${o.enquiryId}`} className="text-brand-dark hover:underline">
              {t('international.offers.openEnquiry', { reference: o.enquiryReference })}
            </Link>
            {o.expiresOn && <span>{t('international.offers.answerBy', { date: day(o.expiresOn, locale) })}</span>}
            <span className="break-all font-mono">{o.termsHash.slice(0, 16)}…</span>
          </div>
          {o.reviewNote && <p className="rounded bg-paper px-3 py-2 text-sm text-ink/80">{t('international.offers.noteSent', { note: o.reviewNote })}</p>}
          {o.declineReason && <p className="rounded bg-paper px-3 py-2 text-sm text-ink/80">{t('international.offers.declinedBecause', { reason: o.declineReason })}</p>}
          {o.status === 'ACCEPTED' && <p className="text-sm font-medium text-brand-dark">{t('international.offers.acceptedHint')}</p>}

          {o.status === 'PENDING_REVIEW' && (
            <div className="space-y-2 rounded border border-dashed border-brand/40 p-3">
              <p className="text-sm text-ink/70">{t('international.offers.reviewHint')}</p>
              <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('international.offers.notePlaceholder')} aria-label={t('international.offers.note')} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={review.isPending} onClick={() => review.mutate({ id: o.id, body: { action: 'SEND', note: note.trim() || null } })}>
                  {t('international.offers.send')}
                </Button>
                <Button size="sm" variant="secondary" disabled={review.isPending || !note.trim()} onClick={() => review.mutate({ id: o.id, body: { action: 'RETURN', note: note.trim() } })}>
                  {t('international.offers.return')}
                </Button>
              </div>
              {review.isError && <p className="text-xs text-danger">{review.error instanceof Error ? review.error.message : t('common.actionFailed')}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Signature({ label, signature }: { label: string; signature: StaffJobOffer['employerSignature'] }) {
  const { t, locale } = useTranslation();
  return (
    <div className="rounded border border-dashed border-border px-3 py-2">
      <p className="text-xs text-ink/50">{label}</p>
      {signature ? (
        <p>
          <span className="font-serif text-base italic text-ink">{signature.name}</span>
          <span className="ml-2 text-xs text-ink/50">{new Date(signature.signedAt).toLocaleString(locale === 'en' ? 'en-GB' : `${locale}-LK`, { timeZone: 'Asia/Colombo' })}</span>
        </p>
      ) : (
        <p className="text-ink/40">{t('international.offers.notSigned')}</p>
      )}
    </div>
  );
}

/** The terms as the employer wrote them, the same rows the caregiver sees. */
export function TermsTable({ terms: o }: { terms: OfferTerms }) {
  const { t, locale } = useTranslation();
  const rows: [string, string][] = [
    [t('international.offers.terms.jobTitle'), o.jobTitle],
    [t('international.offers.terms.where'), [o.city, countryName(o.country, locale)].filter(Boolean).join(', ')],
    [t('international.offers.terms.start'), o.startDate ? day(o.startDate, locale) : t('international.offers.terms.tbc')],
    [t('international.offers.terms.contract'), t('international.offers.terms.months', { n: o.contractMonths })],
    [t('international.offers.terms.hours'), t('international.offers.terms.hoursValue', { n: o.hoursPerWeek })],
    [t('international.offers.terms.salary'), `${money(o.salaryAmount, o.salaryCurrency, locale)} / ${t(`international.vacancies.periods.${o.salaryPeriod}`)}`],
    [t('international.offers.terms.accommodation'), t(`international.offers.accommodation.${o.accommodation}`)],
    [t('international.offers.terms.meals'), o.mealsProvided ? t('common.yes') : t('common.no')],
    [t('international.offers.terms.flights'), t(`international.offers.flights.${o.flightsPaidBy}`)],
    [t('international.offers.terms.leave'), o.annualLeaveDays === null ? '-' : t('international.offers.terms.days', { n: o.annualLeaveDays })],
    [t('international.offers.terms.probation'), o.probationMonths === null ? '-' : t('international.offers.terms.months', { n: o.probationMonths })],
  ];
  return (
    <div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border py-1">
            <dt className="text-ink/60">{k}</dt>
            <dd className="text-right font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {o.otherTerms && <p className="mt-2 whitespace-pre-line rounded bg-paper px-3 py-2 text-sm text-ink/80">{o.otherTerms}</p>}
    </div>
  );
}
