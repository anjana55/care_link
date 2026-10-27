'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, ExternalLink, Pencil } from 'lucide-react';
import { vacancyStatusValues, type StaffVacancy, type StaffVacancyApplication, type VacancyStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useReviewVacancy, useStaffVacancies, useUpdateApplication, useVacancyApplications } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { countryName } from './shared';
import { ReadinessBar } from './readiness-bar';
import { StaffVacancyForm } from './staff-vacancy-form';

const STATUS_STYLES: Record<VacancyStatus, string> = {
  PENDING_REVIEW: 'bg-accent text-white',
  PUBLISHED: 'bg-brand-light text-brand-dark',
  REJECTED: 'bg-danger-light text-danger',
  CLOSED: 'bg-ink/10 text-ink/60',
  FILLED: 'bg-brand text-white',
};

/**
 * The vacancy board from the office: vacancies employers posted wait here
 * for review, and each vacancy's applicants are read and put forward (or
 * not). Putting someone forward makes them a candidate on the vacancy's
 * enquiry, where the interview and placement follow as usual.
 */
export function VacanciesTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<VacancyStatus | 'all'>('PENDING_REVIEW');
  const { data = [], isLoading } = useStaffVacancies({ status: filter === 'all' ? undefined : filter });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.vacancies.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as VacancyStatus | 'all')} aria-label={t('international.vacancies.filter')}>
          {[...vacancyStatusValues, 'all' as const].map((f) => (
            <option key={f} value={f}>
              {t(`international.vacancies.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.vacancies.empty')}</p>}
      <div className="space-y-4">
        {data.map((v) => (
          <VacancyCard key={v.id} vacancy={v} />
        ))}
      </div>
    </div>
  );
}

export function VacancyCard({ vacancy: v, compact = false }: { vacancy: StaffVacancy; compact?: boolean }) {
  const { t, locale } = useTranslation();
  const review = useReviewVacancy();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const salary =
    v.salaryMin != null || v.salaryMax != null
      ? `${v.salaryCurrency} ${[v.salaryMin, v.salaryMax].filter((x) => x != null).join(' – ')} / ${t(`international.vacancies.periods.${v.salaryPeriod ?? 'MONTH'}`)}`
      : null;

  const decide = (status: 'PUBLISHED' | 'REJECTED' | 'CLOSED' | 'FILLED') => {
    setError(null);
    if (status === 'REJECTED' && !note.trim()) return setError(t('international.vacancies.noteRequired'));
    review.mutate({ id: v.id, status, note: note.trim() || undefined }, { onSuccess: () => setNote(''), onError: (err) => setError(err instanceof Error ? err.message : String(err)) });
  };

  return (
    <article className="rounded-lg border border-border bg-white">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-ink">{v.title}</h3>
            <p className="text-xs text-ink/60">
              {v.reference} ·{' '}
              <Link href={`/international/${v.enquiryId}`} className="text-brand-dark hover:underline">
                {v.enquiryReference}
              </Link>{' '}
              · {v.organisationName}
              {v.employer && ` (${t(`international.employers.status.${v.employer.status}`)})`}
            </p>
          </div>
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[v.status])}>{t(`international.vacancies.filters.${v.status}`)}</span>
        </div>
        <p className="mt-2 text-sm text-ink/70">
          {[v.city, countryName(v.country, locale)].filter(Boolean).join(', ')} · {t(`careTypes.${v.careSetting}`)} · {t('international.vacancies.roles', { count: v.rolesCount })}
          {salary && ` · ${salary}`}
          {v.contractMonths && ` · ${t('international.vacancies.contract', { months: v.contractMonths })}`}
        </p>
        {!compact && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-ink/80">{v.description}</p>}
        {v.reviewNote && <p className="mt-2 text-xs text-ink/60">{t('international.profiles.lastNote', { note: v.reviewNote })}</p>}

        {editing ? (
          <div className="mt-4">
            <StaffVacancyForm vacancy={v} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            {(v.status === 'PENDING_REVIEW' || v.status === 'PUBLISHED') && (
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('international.vacancies.notePlaceholder')} />
            )}
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {(v.status === 'PENDING_REVIEW' || v.status === 'REJECTED' || v.status === 'CLOSED') && (
                <Button size="sm" disabled={review.isPending} onClick={() => decide('PUBLISHED')}>
                  {t('international.vacancies.publish')}
                </Button>
              )}
              {v.status === 'PENDING_REVIEW' && (
                <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('REJECTED')}>
                  {t('international.vacancies.sendBack')}
                </Button>
              )}
              {v.status === 'PUBLISHED' && (
                <>
                  <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('FILLED')}>
                    {t('international.vacancies.markFilled')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('CLOSED')}>
                    {t('international.vacancies.close')}
                  </Button>
                  {/* The public site, on the same host: a plain link, outside the staff app's base path. */}
                  <a href={`/work-abroad/vacancies/${v.reference}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
                    <ExternalLink size={12} aria-hidden />
                    {t('international.vacancies.onBoard')}
                  </a>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil size={14} aria-hidden />
                {t('international.vacancies.edit')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-border bg-paper/60 px-5 py-2.5 text-left text-sm font-medium text-ink hover:bg-paper"
      >
        <span>
          {t('international.vacancies.applications', { count: v.applicationCount })}
          {v.newApplications > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 text-xs font-semibold text-white">{v.newApplications}</span>}
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
      </button>
      {open && <Applications vacancyId={v.id} />}
    </article>
  );
}

function Applications({ vacancyId }: { vacancyId: string }) {
  const { t } = useTranslation();
  const { data = [], isLoading } = useVacancyApplications(vacancyId);
  if (isLoading) return <p className="px-5 py-4 text-sm text-ink/50">{t('common.loading')}</p>;
  if (!data.length) return <p className="px-5 py-4 text-sm text-ink/50">{t('international.vacancies.noApplications')}</p>;
  return (
    <ul className="divide-y divide-border">
      {data.map((a) => (
        <ApplicationRow key={a.id} vacancyId={vacancyId} application={a} />
      ))}
    </ul>
  );
}

function ApplicationRow({ vacancyId, application: a }: { vacancyId: string; application: StaffVacancyApplication }) {
  const { t } = useTranslation();
  const update = useUpdateApplication(vacancyId);
  const [message, setMessage] = useState('');
  const decided = a.status !== 'APPLIED';

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/caregivers/${a.caregiverId}`} className="font-medium text-brand-dark hover:underline">
            {a.fullName}
          </Link>
          <span className="ml-2 text-xs tabular-nums text-ink/50">{a.registrationNumber}</span>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            <ReadinessBar report={a.readiness} />
            {a.profileLive ? <span className="text-brand-dark">{t('international.pool.live')}</span> : <span className="text-danger">{t('international.candidates.notLive')}</span>}
            <span className="text-ink/50">{new Date(a.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <span className="rounded bg-paper px-2 py-0.5 text-xs font-medium text-ink/70">{t(`international.vacancies.appStatus.${a.status}`)}</span>
      </div>
      {a.message && <p className="mt-2 rounded bg-paper px-3 py-2 text-sm text-ink/80">{a.message}</p>}
      {!decided && (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('international.candidates.messagePlaceholder')} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!a.profileLive || update.isPending} onClick={() => update.mutate({ id: a.id, status: 'PUT_FORWARD', messageToEmployer: message.trim() || null })}>
              {t('international.vacancies.putForward')}
            </Button>
            <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: a.id, status: 'NOT_SUCCESSFUL' })}>
              {t('international.vacancies.notSuccessful')}
            </Button>
          </div>
          {!a.profileLive && <p className="text-xs text-ink/50">{t('international.vacancies.needsLiveProfile')}</p>}
        </div>
      )}
      {update.isError && <p className="mt-2 text-xs text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
    </li>
  );
}
