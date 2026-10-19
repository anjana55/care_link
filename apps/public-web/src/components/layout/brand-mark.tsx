'use client';

import { useBranding } from '@/lib/branding/provider';
import { cn } from '@/lib/utils';

/**
 * The company's mark on public pages: the logo from Settings > Branding, or
 * the company name in the brand colour when there is no logo.
 */
export function BrandMark({ className }: { className?: string }) {
  const { companyName, logoUrl } = useBranding();
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={companyName} className={cn('h-8 w-auto max-w-[10rem] object-contain', className)} />;
  }
  return <span className={cn('truncate text-base font-semibold text-brand-dark', className)}>{companyName}</span>;
}
