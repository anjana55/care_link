import { cn } from '@/lib/utils';
import type { CaregiverStatus, ClientStatus } from '@/lib/api/types';

// Shared by both status ladders. Typed as Record<string, string> rather than
// Record<CaregiverStatus | ClientStatus, string> because the two ladders
// overlap on three names (ACTIVE/INACTIVE/SUSPENDED) and a strict union key
// would force every client-only state to be spelled out against the caregiver
// type. An unknown status falls through to '' and renders unstyled - the
// caregiver-only states below keep the original colors unchanged.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-ink/10 text-ink',
  REGISTERED: 'bg-brand-light text-brand-dark',
  DOCUMENTS_PENDING: 'bg-accent-light text-accent',
  UNDER_VERIFICATION: 'bg-accent-light text-accent',
  VERIFIED: 'bg-brand-light text-brand-dark',
  REJECTED: 'bg-danger-light text-danger',
  // Shared by both ladders.
  ACTIVE: 'bg-brand text-white',
  INACTIVE: 'bg-ink/10 text-ink/60',
  SUSPENDED: 'bg-danger-light text-danger',
  // Client-only (see clientStatusEnum on the API).
  PENDING_REVIEW: 'bg-accent-light text-accent',
};

export function StatusBadge({ status, label }: { status: CaregiverStatus | ClientStatus; label: string }) {
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
