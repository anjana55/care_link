'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Megaphone, MessageSquare, Plus, UserX } from 'lucide-react';
import type { EmployerCandidate, EmployerOwnEnquiry } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { useCandidateActions, useEmployerAccount, useEmployerEnquiries } from '@/lib/hooks/use-international';
import { EmployerStatusBanner, CandidateStatusBadge } from '@/components/international/employer-status';
import { TalentPhoto } from '@/components/international/talent-card';
import { Button } from '@/components/ui/button';

/**
 * The employer's overview: whether they are verified, and each enquiry with
 * the caregivers on it - put forward by staff or asked about by the employer -
 * and where each one stands. Every next step goes through staff.
 */
export default function EmployerOverviewPage() {
  const { t, locale } = useTranslation();
  const { data: account } = useEmployerAccount();
  const { data: enquiries = [], isLoading, isError } = useEmployerEnquiries(locale);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{account ? t('employer.overview.title', { name: account.organisationName }) : t('employer.nav.overview')}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('employer.overview.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {account?.status === 'VERIFIED' && (
            <Link href="/employer/vacancies/new" className="inline-flex items-center gap-2 rounded-DEFAULT border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-light">
              <Megaphone className="h-4 w-4" aria-hidden />
              {t('employer.vacancies.new')}
            </Link>
          )}
          <Link href="/employer/enquiries/new" className="inline-flex items-center gap-2 rounded-DEFAULT bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            <Plus className="h-4 w-4" aria-hidden />
            {t('employer.nav.newEnquiry')}
          </Link>
        </div>
      </div>

      {account && <EmployerStatusBanner account={account} />}

      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-white" aria-hidden />}
      {isError && <p className="text-sm text-danger">{t('portal.loadError')}</p>}
      {!isLoading && enquiries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
          <p className="text-sm text-ink/60">{t('employer.overview.empty')}</p>
          <Link href="/employer/enquiries/new" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
            {t('employer.overview.emptyCta')}
          </Link>
        </div>
      )}
      {enquiries.map((e) => (
        <EnquiryCard key={e.id} enquiry={e} verified={account?.status === 'VERIFIED'} />
      ))}
    </div>
  );
}

function EnquiryCard({ enquiry, verified }: { enquiry: EmployerOwnEnquiry; verified: boolean }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const created = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(enquiry.createdAt));

  return (
    <section aria-labelledby={`enq-${enquiry.id}`} className="rounded-lg border border-border bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 id={`enq-${enquiry.id}`} className="font-semibold tabular-nums text-ink">
            {enquiry.reference}
          </h2>
          <p className="mt-0.5 text-sm text-ink/60">
            {t('employer.overview.summary', { count: enquiry.rolesCount, country: countries.name(enquiry.country) })} ·{' '}
            {enquiry.careSettings.map((c) => t(`careTypes.${c}`)).join(', ')}
          </p>
          <p className="mt-0.5 text-xs text-ink/50">{t('employer.overview.sent', { date: created })}</p>
        </div>
        <span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold text-ink/70">{t(`employer.enquiryStatus.${enquiry.status}`)}</span>
      </div>
      {enquiry.candidates.length === 0 ? (
        <p className="p-5 text-sm text-ink/60">{t('employer.overview.noCandidates')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {enquiry.candidates.map((c) => (
            <CandidateRow key={c.id} candidate={c} verified={verified} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateRow({ candidate, verified }: { candidate: EmployerCandidate; verified: boolean }) {
  const { t, locale } = useTranslation();
  const { act } = useCandidateActions(locale);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<'DECLINE' | null>(null);
  const talent = candidate.talent;
  const interview = candidate.interviewAt ? new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(candidate.interviewAt)) : null;

  if (!talent) {
    return (
      <li className="flex items-center gap-3 p-5 text-sm text-ink/60">
        <UserX className="h-5 w-5 text-ink/40" aria-hidden />
        {t('employer.overview.noLongerAvailable')}
      </li>
    );
  }

  const run = (action: 'REQUEST_INTERVIEW' | 'SELECT' | 'DECLINE') =>
    act.mutate({ id: candidate.id, action, message: message.trim() || undefined }, { onSuccess: () => (setMessage(''), setConfirming(null)) });
  const canRequest = candidate.status === 'PROPOSED';
  const canSelect = ['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED'].includes(candidate.status);
  const canDecline = !['PLACED', 'NOT_PROCEEDING'].includes(candidate.status);

  return (
    <li className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        <TalentPhoto photoUrl={talent.photoUrl} firstName={talent.firstName} className="h-14 w-14 shrink-0 text-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/talent/${talent.slug}`} className="font-semibold text-ink hover:text-brand-dark hover:underline">
              {talent.firstName}
            </Link>
            <CandidateStatusBadge status={candidate.status} />
          </div>
          {talent.headline && <p className="text-sm text-ink/60">{talent.headline}</p>}
          <p className="mt-1 text-xs text-ink/50">
            {t('results.yearsExperience', { years: talent.yearsExperience })}
            {talent.languages.length > 0 && ` · ${talent.languages.map((l) => l.name).join(', ')}`}
          </p>
          {interview && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-brand-dark">
              <CalendarClock className="h-4 w-4" aria-hidden />
              {t('employer.overview.interviewAt', { when: interview })}
            </p>
          )}
          {candidate.messageToEmployer && (
            <p className="mt-2 flex gap-1.5 rounded bg-paper px-3 py-2 text-sm text-ink/80">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" aria-hidden />
              <span>
                <span className="font-semibold">{t('employer.overview.fromOurTeam')}</span> {candidate.messageToEmployer}
              </span>
            </p>
          )}
        </div>
      </div>

      {(canRequest || canSelect || canDecline) && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {(canRequest || canSelect) && (
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1000}
              placeholder={t('employer.overview.messagePlaceholder')}
              aria-label={t('employer.overview.messageLabel')}
              className="w-full rounded-DEFAULT border border-border px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canRequest && (
              <Button size="sm" disabled={!verified || act.isPending} onClick={() => run('REQUEST_INTERVIEW')}>
                {t('employer.overview.requestInterview')}
              </Button>
            )}
            {canSelect && (
              <Button size="sm" variant={canRequest ? 'secondary' : 'primary'} disabled={!verified || act.isPending} onClick={() => run('SELECT')}>
                {t('employer.overview.select')}
              </Button>
            )}
            {canDecline &&
              (confirming === 'DECLINE' ? (
                <span className="flex items-center gap-2 text-sm">
                  {t('employer.overview.declineConfirm')}
                  <Button size="sm" variant="danger" disabled={act.isPending} onClick={() => run('DECLINE')}>
                    {t('employer.overview.declineYes')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {t('employer.overview.declineNo')}
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => setConfirming('DECLINE')}>
                  {t('employer.overview.decline')}
                </Button>
              ))}
          </div>
          {!verified && (canRequest || canSelect) && <p className="text-xs text-ink/50">{t('employer.overview.verifyFirst')}</p>}
          {act.isError && (
            <p role="alert" className="text-xs text-danger">
              {act.error instanceof ApiError ? act.error.message : t('portal.saveError')}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
