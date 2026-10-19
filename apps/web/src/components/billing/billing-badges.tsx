import { cn } from '@/lib/utils';
import type { InvoiceStatus, PayoutStatus } from '@/lib/api/types';

const INVOICE: Record<InvoiceStatus, string> = {
  DRAFT: 'border border-dashed border-accent text-accent',
  ISSUED: 'bg-brand-light text-brand-dark',
  PAID: 'bg-brand text-white',
  VOID: 'bg-ink/10 text-ink/50 line-through',
};

const PAYOUT: Record<PayoutStatus, string> = {
  DRAFT: 'border border-dashed border-accent text-accent',
  APPROVED: 'bg-brand-light text-brand-dark',
  PAID: 'bg-brand text-white',
  VOID: 'bg-ink/10 text-ink/50 line-through',
};

const base = 'inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium';

export function InvoiceStatusBadge({ status, label }: { status: InvoiceStatus; label: string }) {
  return <span className={cn(base, INVOICE[status])}>{label}</span>;
}

export function OverdueBadge({ label }: { label: string }) {
  return <span className={cn(base, 'bg-danger-light text-danger')}>{label}</span>;
}

export function PayoutStatusBadge({ status, label }: { status: PayoutStatus; label: string }) {
  return <span className={cn(base, PAYOUT[status])}>{label}</span>;
}
