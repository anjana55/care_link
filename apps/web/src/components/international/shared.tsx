'use client';

import type { EmployerEnquiryStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

const ENQUIRY_STYLES: Record<EmployerEnquiryStatus, string> = {
  NEW: 'bg-accent text-white',
  IN_PROGRESS: 'bg-accent-light text-accent',
  INTRODUCED: 'bg-brand-light text-brand-dark',
  PLACED: 'bg-brand text-white',
  CLOSED: 'bg-ink/10 text-ink/60',
};

export function EnquiryStatusBadge({ status }: { status: EmployerEnquiryStatus }) {
  const { t } = useTranslation();
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', ENQUIRY_STYLES[status])}>{t(`international.status.${status}`)}</span>;
}

/** A country name in the staff member's language, from the browser. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** An amount in its currency, in the staff member's number format. */
export function money(amount: string | number | null, currency: string | null, locale: string): string {
  if (amount === null || !currency) return '-';
  const n = typeof amount === 'number' ? amount : Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** 'YYYY-MM-DD' as a short date, with no time zone shift. */
export function day(date: string | null, locale: string): string {
  if (!date) return '-';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
}
