'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/provider';
import { useBranding } from '@/lib/branding/provider';

/**
 * The company mark, used by the staff sidebar, the caregiver header and every
 * auth page: the logo from Settings > Branding, or - without one - a badge
 * with the short name in the brand colour, beside the company name.
 *
 * The public site lives at the domain root, outside this app's `/staff`
 * basePath, so callers link to it with a plain anchor rather than next/link
 * (which would prefix the href and 404).
 */
export const PUBLIC_SITE_URL = '/';

export function BrandMark({
  size = 'sm',
  showName = true,
  className,
}: {
  size?: 'sm' | 'lg';
  showName?: boolean;
  className?: string;
}) {
  const large = size === 'lg';
  const { companyName, shortName, logoUrl } = useBranding();

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      {logoUrl ? (
        // A logo is usually wider than it is tall: fixed height, natural width, capped.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={showName ? '' : companyName} className={cn('w-auto object-contain', large ? 'h-11 max-w-[11rem]' : 'h-8 max-w-[6rem]')} />
      ) : (
        <span
          className={cn(
            'flex shrink-0 items-center justify-center rounded bg-brand font-bold text-white',
            large ? 'h-11 min-w-11 px-1 text-base' : 'h-8 min-w-8 px-1 text-sm',
          )}
          aria-hidden={showName}
          aria-label={showName ? undefined : companyName}
        >
          {shortName}
        </span>
      )}
      {showName && (
        <span className={cn('truncate font-semibold text-ink', large ? 'text-base' : 'text-sm')} title={companyName}>
          {companyName}
        </span>
      )}
    </span>
  );
}

/** A "back to the public site" link. Anchor, not next/link - see above. */
export function PublicSiteLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={PUBLIC_SITE_URL}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium text-ink/60 transition-colors hover:text-brand',
        className,
      )}
    >
      {children}
    </a>
  );
}

/**
 * The signed-out landing bar: the company mark linking into the staff app,
 * plus the way back out to the public site. Every auth page under this app
 * used to be a dead end - a centred card with no way home except the browser
 * back button, and no name on the product at all.
 */
export function AuthHeader() {
  const { t } = useTranslation();
  const { companyName } = useBranding();

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-white px-4 py-3 sm:px-6">
      <Link
        href="/login"
        className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <BrandMark />
      </Link>
      <PublicSiteLink className="shrink-0">
        <ArrowLeft size={15} />
        <span className="hidden sm:inline">{t('nav.backToPublic')}</span>
        <span className="max-w-[8rem] truncate sm:hidden">{companyName}</span>
      </PublicSiteLink>
    </header>
  );
}
