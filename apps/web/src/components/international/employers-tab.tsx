'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, MailWarning } from 'lucide-react';
import type { EmployerAdminRow } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useEmployerAccounts, useReviewEmployer } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { countryName } from './shared';

const FILTERS = ['PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'all'] as const;

const STATUS_STYLES: Record<string, string> = {
  PENDING_REVIEW: 'bg-accent-light text-accent',
  VERIFIED: 'bg-brand-light text-brand-dark',
  REJECTED: 'bg-danger-light text-danger',
  SUSPENDED: 'bg-danger-light text-danger',
};

/**
 * Employer accounts. Verifying one is what lets it ask for interviews, so
 * this is where staff check the organisation is real and recruiting lawfully
 * before anything reaches a caregiver.
 */
export function EmployersTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('PENDING_REVIEW');
  const { data = [], isLoading } = useEmployerAccounts(filter);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.employers.hint')}</p>
        <Select className="sm:w-56" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.employers.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.employers.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && (
        <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.employers.empty')}</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((e) => (
          <EmployerCard key={e.id} employer={e} />
        ))}
      </div>
    </div>
  );
}

function EmployerCard({ employer: e }: { employer: EmployerAdminRow }) {
  const { t, locale } = useTranslation();
  const review = useReviewEmployer();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = (decision: 'VERIFY' | 'REJECT' | 'SUSPEND') => {
    setError(null);
    if (decision !== 'VERIFY' && !note.trim()) return setError(t('international.employers.noteRequired'));
    review.mutate({ id: e.id, decision, note: note.trim() || undefined }, { onError: (err) => setError(err instanceof Error ? err.message : String(err)) });
  };
  const website = e.website ? (/^https?:\/\//.test(e.website) ? e.website : `https://${e.website}`) : null;

  return (
    <article className="rounded-lg border border-border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">{e.organisationName}</h3>
          <p className="text-xs text-ink/60">
            {t(`international.employerTypes.${e.organisationType}`)} · {countryName(e.country, locale)}
          </p>
        </div>
        <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[e.status])}>{t(`international.employers.status.${e.status}`)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink/50">{t('international.detail.contact')}</dt>
        <dd>{e.contactName}</dd>
        <dt className="text-ink/50">{t('international.detail.email')}</dt>
        <dd className="flex items-center gap-1.5">
          {e.email}
          {!e.emailVerified && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <MailWarning size={12} aria-hidden />
              {t('international.employers.unconfirmed')}
            </span>
          )}
        </dd>
        {e.phone && (
          <>
            <dt className="text-ink/50">{t('international.detail.phone')}</dt>
            <dd>{e.phone}</dd>
          </>
        )}
        {website && (
          <>
            <dt className="text-ink/50">{t('international.detail.website')}</dt>
            <dd>
              <a href={website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-dark hover:underline">
                <ExternalLink size={12} aria-hidden />
                {e.website}
              </a>
            </dd>
          </>
        )}
        {e.companyRegistrationNumber && (
          <>
            <dt className="text-ink/50">{t('international.employers.registration')}</dt>
            <dd>{e.companyRegistrationNumber}</dd>
          </>
        )}
        <dt className="text-ink/50">{t('international.employers.enquiries')}</dt>
        <dd>
          {e.enquiryCount > 0 ? (
            <Link href={`/international?tab=enquiries`} className="text-brand-dark hover:underline">
              {e.enquiryCount}
            </Link>
          ) : (
            0
          )}
        </dd>
        <dt className="text-ink/50">{t('international.employers.signedUp')}</dt>
        <dd>{new Date(e.createdAt).toLocaleDateString()}</dd>
      </dl>
      {e.reviewNote && <p className="mt-2 text-xs text-ink/60">{t('international.profiles.lastNote', { note: e.reviewNote })}</p>}

      <div className="mt-4 space-y-3 border-t border-border pt-4">
        <Textarea rows={2} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} placeholder={t('international.employers.notePlaceholder')} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {e.status !== 'VERIFIED' && (
            <Button size="sm" disabled={review.isPending || !e.emailVerified} onClick={() => decide('VERIFY')}>
              {t('international.employers.verify')}
            </Button>
          )}
          {e.status === 'PENDING_REVIEW' && (
            <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('REJECT')}>
              {t('international.employers.reject')}
            </Button>
          )}
          {e.status !== 'SUSPENDED' && e.status !== 'PENDING_REVIEW' && (
            <Button size="sm" variant="secondary" disabled={review.isPending} onClick={() => decide('SUSPEND')}>
              {t('international.employers.suspend')}
            </Button>
          )}
        </div>
        {!e.emailVerified && <p className="text-xs text-ink/50">{t('international.employers.confirmFirst')}</p>}
      </div>
    </article>
  );
}
