'use client';

import Link from 'next/link';
import { ExternalLink, Pencil, Plus, Users } from 'lucide-react';
import type { Vacancy, VacancyStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate } from '@/lib/colombo-time';
import { ApiError } from '@/lib/api/client';
import { useCloseVacancy, useEmployerAccount, useEmployerVacancies } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<VacancyStatus, string> = {
  PENDING_REVIEW: 'bg-accent-light text-accent-dark',
  PUBLISHED: 'bg-brand text-white',
  REJECTED: 'bg-red-100 text-red-800',
  CLOSED: 'bg-ink/10 text-ink/60',
  FILLED: 'bg-brand-dark text-white',
};

/**
 * The employer's vacancies. Our team reviews each one before it goes on the
 * board, and puts forward the applicants who fit - who then appear on the
 * Overview as candidates. Applicants are never shown here: only how many.
 */
export default function EmployerVacanciesPage() {
  const { t } = useTranslation();
  const { data: account } = useEmployerAccount();
  const { data = [], isLoading, isError } = useEmployerVacancies();
  const verified = account?.status === 'VERIFIED';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{t('employer.vacancies.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink/60">{t('employer.vacancies.intro')}</p>
        </div>
        {verified && (
          <Link href="/employer/vacancies/new" className="inline-flex items-center gap-2 rounded-DEFAULT bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
            <Plus className="h-4 w-4" aria-hidden />
            {t('employer.vacancies.new')}
          </Link>
        )}
      </div>
      {account && !verified && <p className="rounded-lg border border-border bg-white p-4 text-sm text-ink/70">{t('employer.vacancies.verifyFirst')}</p>}
      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-white" aria-hidden />}
      {isError && <p className="text-sm text-danger">{t('portal.loadError')}</p>}
      {!isLoading && verified && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
          <p className="text-sm text-ink/60">{t('employer.vacancies.empty')}</p>
          <Link href="/employer/vacancies/new" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
            {t('employer.vacancies.emptyCta')}
          </Link>
        </div>
      )}
      <ul className="space-y-4">
        {data.map((v) => (
          <VacancyRow key={v.id} vacancy={v} />
        ))}
      </ul>
    </div>
  );
}

function VacancyRow({ vacancy: v }: { vacancy: Vacancy }) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const close = useCloseVacancy();
  const editable = v.status === 'PENDING_REVIEW' || v.status === 'REJECTED';
  const closable = editable || v.status === 'PUBLISHED';

  return (
    <li className="rounded-lg border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{v.title}</h2>
          <p className="mt-0.5 text-sm text-ink/60">
            {[v.city, countries.name(v.country)].filter(Boolean).join(', ')} · {t(`careTypes.${v.careSetting}`)} · {t('vacancies.roles', { count: v.rolesCount })}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-ink/50">
            {v.reference} · {t('employer.vacancies.enquiry', { reference: v.enquiryReference })}
            {v.closesOn && ` · ${t('vacancies.closes', { date: fmtDate(v.closesOn, locale) })}`}
          </p>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', STATUS_STYLE[v.status])}>{t(`employer.vacancies.status.${v.status}`)}</span>
      </div>
      {v.status === 'REJECTED' && v.reviewNote && (
        <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-900">
          <span className="font-semibold">{t('employer.status.note')}</span> {v.reviewNote}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
        <span className="inline-flex items-center gap-1.5 text-ink/70">
          <Users className="h-4 w-4 text-ink/40" aria-hidden />
          {t('employer.vacancies.applications', { count: v.applicationCount })}
        </span>
        {v.status === 'PUBLISHED' && (
          <Link href={`/work-abroad/vacancies/${v.reference}`} className="inline-flex items-center gap-1 font-medium text-brand hover:text-brand-dark">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {t('employer.vacancies.viewOnBoard')}
          </Link>
        )}
        <span className="ml-auto flex gap-2">
          {editable && (
            <Link href={`/employer/vacancies/${v.id}`} className="inline-flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('employer.vacancies.edit')}
            </Link>
          )}
          {closable && (
            <Button size="sm" variant="ghost" disabled={close.isPending} onClick={() => close.mutate(v.id)}>
              {t('employer.vacancies.close')}
            </Button>
          )}
        </span>
      </div>
      {close.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {close.error instanceof ApiError ? close.error.message : t('portal.saveError')}
        </p>
      )}
    </li>
  );
}
