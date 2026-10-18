import { cn } from '@/lib/utils';
import type { BookingStatus, ShiftStatus } from '@/lib/api/types';

const BOOKING: Record<BookingStatus, string> = {
  DRAFT: 'bg-accent-light text-accent',
  CONFIRMED: 'bg-brand text-white',
  COMPLETED: 'bg-brand-light text-brand-dark',
  CANCELLED: 'bg-ink/10 text-ink/60',
};

const SHIFT: Record<ShiftStatus, string> = {
  DRAFT: 'border border-dashed border-accent text-accent',
  SCHEDULED: 'bg-brand-light text-brand-dark',
  COMPLETED: 'bg-brand text-white',
  MISSED: 'bg-danger-light text-danger',
  CANCELLED: 'bg-ink/10 text-ink/50 line-through',
};

export function BookingStatusBadge({ status, label }: { status: BookingStatus; label: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', BOOKING[status])}>{label}</span>;
}

export function ShiftStatusBadge({ status, label }: { status: ShiftStatus; label: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', SHIFT[status])}>{label}</span>;
}
