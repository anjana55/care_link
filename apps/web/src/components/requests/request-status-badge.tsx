import { cn } from '@/lib/utils';
import type { CareRequestStatus } from '@/lib/api/types';

const STYLES: Record<CareRequestStatus, string> = {
  NEW: 'bg-accent-light text-accent',
  IN_PROGRESS: 'bg-brand-light text-brand-dark',
  INTRODUCED: 'bg-brand text-white',
  CLOSED: 'bg-ink/10 text-ink/60',
  CANCELLED: 'bg-ink/10 text-ink/60',
};

export function RequestStatusBadge({ status, label }: { status: CareRequestStatus; label: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', STYLES[status])}>{label}</span>;
}
