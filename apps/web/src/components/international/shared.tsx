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
