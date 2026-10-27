'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { StaffAssessment } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAssessmentActions, useAssessments } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { day } from './shared';

const FILTERS = ['pending', 'verified', 'all'] as const;

/**
 * Test results - mostly English tests - caregivers added themselves. Staff
 * check each against the original (seen in the office, or a copy on the
 * caregiver's documents) before it counts and shows on a talent profile.
 * Staff record results directly on the caregiver's profile.
 */
export function ResultsTab() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const { data = [], isLoading } = useAssessments({ status: filter });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink/60">{t('international.results.hint')}</p>
        <Select className="sm:w-48" value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])} aria-label={t('international.results.filter')}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`international.results.filters.${f}`)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {!isLoading && data.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white py-10 text-center text-sm text-ink/50">{t('international.results.empty')}</p>}
      {data.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-white">
          {data.map((a) => (
            <ResultRow key={a.id} result={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResultRow({ result: a, showCaregiver = true }: { result: StaffAssessment; showCaregiver?: boolean }) {
  const { t, locale } = useTranslation();
  const { verify, remove } = useAssessmentActions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        {showCaregiver && (
          <p>
            <Link href={`/caregivers/${a.caregiverId}`} className="font-medium text-brand-dark hover:underline">
              {a.fullName}
            </Link>
            <span className="ml-2 text-xs tabular-nums text-ink/50">{a.registrationNumber}</span>
          </p>
        )}
        <p className="text-ink">
          <span className="font-medium">{a.title}</span>
          {a.score && <span className="ml-2 tabular-nums">{a.score}</span>}
          {a.cefrLevel && <span className="ml-2 rounded bg-paper px-1.5 text-xs font-semibold">{a.cefrLevel}</span>}
        </p>
        <p className="text-xs text-ink/50">
          {t(`international.results.provider.${a.provider}`)} · {t(`international.results.kind.${a.kind}`)} · {t('international.results.taken', { date: day(a.takenOn, locale) })}
          {a.validUntil && ` · ${t('international.results.until', { date: day(a.validUntil, locale) })}`} · {t(`international.results.addedBy.${a.addedBy}`)}
        </p>
        {a.note && <p className="text-xs text-ink/60">{a.note}</p>}
      </div>
      <span className={a.verified ? 'rounded bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark' : 'rounded bg-accent-light px-2 py-0.5 text-xs font-medium text-accent'}>
        {a.verified ? t('international.results.verified') : t('international.results.unverified')}
      </span>
      <Button size="sm" variant={a.verified ? 'ghost' : 'primary'} disabled={verify.isPending} onClick={() => verify.mutate({ id: a.id, verified: !a.verified })}>
        {a.verified ? t('international.results.unverify') : t('international.results.verify')}
      </Button>
      {confirmDelete ? (
        <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>
          {t('international.results.confirmDelete')}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
          {t('common.delete')}
        </Button>
      )}
    </li>
  );
}
