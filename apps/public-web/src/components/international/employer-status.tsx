'use client';

import Link from 'next/link';
import { Clock, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import type { EmployerAccount, CandidateStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Where the employer's verification stands, and what it means for what they can do. */
export function EmployerStatusBanner({ account }: { account: EmployerAccount }) {
  const { t } = useTranslation();
  const tone = {
    VERIFIED: { icon: ShieldCheck, cls: 'border-brand/30 bg-brand-light/50 text-brand-dark' },
    PENDING_REVIEW: { icon: Clock, cls: 'border-accent/30 bg-accent/5 text-accent-dark' },
    REJECTED: { icon: ShieldX, cls: 'border-danger/30 bg-danger/5 text-danger' },
    SUSPENDED: { icon: ShieldAlert, cls: 'border-danger/30 bg-danger/5 text-danger' },
  }[account.status];
  const Icon = tone.icon;
  return (
    <div role="status" className={cn('flex gap-3 rounded-lg border px-4 py-3', tone.cls)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="text-sm">
        <p className="font-semibold">{t(`employer.status.${account.status}`)}</p>
        <p className="mt-0.5 opacity-90">{t(`employer.status.${account.status}Hint`)}</p>
        {account.reviewNote && account.status !== 'VERIFIED' && (
          <p className="mt-2 rounded bg-white/70 px-3 py-2 text-xs text-ink">
            <span className="font-semibold">{t('employer.status.note')}</span> {account.reviewNote}
          </p>
        )}
        {account.status === 'REJECTED' && (
          <Link href="/employer/account" className="mt-2 inline-block text-xs font-semibold underline-offset-2 hover:underline">
            {t('employer.status.updateDetails')}
          </Link>
        )}
      </div>
    </div>
  );
}

const CANDIDATE_STYLES: Record<CandidateStatus, string> = {
  PROPOSED: 'bg-accent-light text-accent-dark',
  INTERVIEW_REQUESTED: 'bg-accent text-white',
  INTERVIEW_SCHEDULED: 'bg-brand-light text-brand-dark',
  SELECTED: 'bg-brand text-white',
  PLACED: 'bg-brand-dark text-white',
  NOT_PROCEEDING: 'bg-ink/10 text-ink/60',
};

export function CandidateStatusBadge({ status }: { status: CandidateStatus }) {
  const { t } = useTranslation();
  return <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', CANDIDATE_STYLES[status])}>{t(`employer.candidate.${status}`)}</span>;
}
