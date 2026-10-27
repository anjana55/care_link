'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, Printer } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';
import { useEmployerAccount, useEmployerOffer, useOfferActions } from '@/lib/hooks/use-international';
import { OfferForm } from '@/components/international/offer-form';
import { OfferStatusBadge, OfferTermsList, SignatureLine } from '@/components/international/offer-terms';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';

/**
 * One job offer: the terms and both signatures, to read or print. While staff
 * have it (or sent it back) the employer can change it and sign again; until
 * the caregiver answers, they can withdraw it.
 */
export default function EmployerOfferPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data: account } = useEmployerAccount();
  const { data: o, isLoading, isError } = useEmployerOffer(id);
  const { update, withdraw } = useOfferActions();
  const [editing, setEditing] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  if (isLoading) return <div className="h-96 animate-pulse rounded-lg bg-white" aria-hidden />;
  if (isError || !o) return <p className="text-sm text-danger">{t('portal.loadError')}</p>;
  const editable = o.status === 'PENDING_REVIEW' || o.status === 'RETURNED';
  const withdrawable = o.status === 'PENDING_REVIEW' || o.status === 'RETURNED' || o.status === 'SENT';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/employer/offers" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-brand-dark">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {t('employer.offers.title')}
        </Link>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm font-medium text-ink/70 hover:text-brand-dark">
          <Printer className="h-4 w-4" aria-hidden />
          {t('employer.offers.print')}
        </button>
      </div>

      {o.status === 'RETURNED' && o.reviewNote && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-ink print:hidden">
          <p className="font-semibold">{t('employer.offers.returnedTitle')}</p>
          <p className="mt-1 whitespace-pre-line">{o.reviewNote}</p>
        </div>
      )}

      <article className="rounded-lg border border-border bg-white p-5 sm:p-6 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('employer.offers.letter')}</p>
            <h1 className="mt-1 text-xl font-bold text-ink">
              {o.talentFirstName} · {o.jobTitle}
            </h1>
            <p className="text-sm text-ink/60">
              {account?.organisationName} · {o.reference} · {o.enquiryReference}
            </p>
          </div>
          <OfferStatusBadge status={o.status} expired={o.expired} />
        </div>
        {o.status === 'SENT' && o.expiresOn && <p className="mt-2 text-sm text-brand-dark">{t('employer.offers.answerBy', { date: fmtDate(o.expiresOn, locale) })}</p>}
        {o.status === 'DECLINED' && o.declineReason && <p className="mt-2 text-sm text-ink/70">{t('employer.offers.declinedBecause', { reason: o.declineReason })}</p>}

        {editing && account ? (
          <div className="mt-5">
            <OfferForm
              initial={o}
              organisationName={account.organisationName}
              talentFirstName={o.talentFirstName}
              pending={update.isPending}
              error={update.error}
              submitLabel={t('employer.offers.signResend')}
              onSubmit={(body) => update.mutate({ id: o.id, body }, { onSuccess: () => setEditing(false) })}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <div className="mt-5">
              <OfferTermsList terms={o} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <SignatureLine label={t('overseas.employerSignature')} signature={o.employerSignature} />
              <SignatureLine label={t('overseas.caregiverSignature')} signature={o.caregiverSignature} />
            </div>
            <p className="mt-4 text-xs text-ink/50">{t('employer.offers.inPrinciple')}</p>
            <p className="mt-1 break-all font-mono text-[10px] text-ink/30">{t('employer.offers.fingerprint', { hash: o.termsHash })}</p>
          </>
        )}
      </article>

      {!editing && (editable || withdrawable) && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {editable && <Button onClick={() => setEditing(true)}>{t('employer.offers.change')}</Button>}
          {withdrawable &&
            (confirmWithdraw ? (
              <span className="flex flex-wrap items-center gap-2 text-sm">
                {t('employer.offers.withdrawConfirm')}
                <Button size="sm" variant="danger" disabled={withdraw.isPending} onClick={() => withdraw.mutate(o.id, { onSuccess: () => setConfirmWithdraw(false) })}>
                  {t('employer.offers.withdrawYes')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmWithdraw(false)}>
                  {t('common.cancel')}
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmWithdraw(true)}>
                {t('employer.offers.withdraw')}
              </Button>
            ))}
          {withdraw.isError && (
            <p role="alert" className="w-full text-sm text-danger">
              {withdraw.error instanceof ApiError ? withdraw.error.message : t('portal.saveError')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
