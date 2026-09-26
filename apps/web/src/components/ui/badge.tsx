import { cn } from '@/lib/utils';
import type { CaregiverStatus } from '@/lib/api/types';

const STATUS_STYLES: Record<CaregiverStatus, string> = {
  DRAFT: 'bg-ink/10 text-ink',
  REGISTERED: 'bg-brand-light text-brand-dark',
  DOCUMENTS_PENDING: 'bg-accent-light text-accent',
  UNDER_VERIFICATION: 'bg-accent-light text-accent',
  VERIFIED: 'bg-brand-light text-brand-dark',
  ACTIVE: 'bg-brand text-white',
  INACTIVE: 'bg-ink/10 text-ink/60',
  SUSPENDED: 'bg-danger-light text-danger',
  REJECTED: 'bg-danger-light text-danger',
};

export function StatusBadge({ status, label }: { status: CaregiverStatus; label: string }) {
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>
      {label}
    </span>
  );
}

export function VerificationBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-accent-light text-accent',
    IN_PROGRESS: 'bg-accent-light text-accent',
    VERIFIED: 'bg-brand-light text-brand-dark',
    REJECTED: 'bg-danger-light text-danger',
  };
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', styles[status] ?? '')}>
      {status.replace('_', ' ')}
    </span>
  );
}
