'use client';

import Link from 'next/link';
import { ArrowLeft, Globe2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { BrandMark } from '@/components/layout/brand-mark';
import { useAuth } from '@/lib/api/auth-context';
import { accountHome } from '@/lib/account-home';
import { cn } from '@/lib/utils';
import { hardNavigate } from '@/lib/navigation';

interface SiteHeaderProps {
  /**
   * Content width. The finder is a full-width map, the auth pages are narrow
   * centred cards - the shell matches whichever is being rendered.
   */
  maxWidth?: 'sm' | '3xl' | '5xl' | 'full';
  /**
   * The landing page at "/" links nowhere useful, so it hides its own back link.
   */
  showBackLink?: boolean;
  /**
   * Optional label for the back link. The caregiver profile overrides this with
   * "Back to results" because /find is the useful destination there, while every
   * other page goes back to the landing page.
   */
  backLabel?: string;
  backHref?: string;
  className?: string;
}

const WIDTH: Record<NonNullable<SiteHeaderProps['maxWidth']>, string> = {
  sm: 'max-w-sm',
  '3xl': 'max-w-3xl',
  '5xl': 'max-w-5xl',
  // The map-first finder runs edge to edge, so its header does too.
  full: 'max-w-none lg:px-6',
};

/**
 * The single header used by every public page. It was previously copy-pasted
 * into six files, which is how the brand link ended up as a plain <span> on one
 * of them - there was no single place to fix it.
 */
export function SiteHeader({
  maxWidth = '5xl',
  showBackLink = true,
  backLabel,
  backHref = '/',
  className,
}: SiteHeaderProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <header className={cn('sticky top-0 z-20 border-b border-border bg-white/90 backdrop-blur', className)}>
      <div className={cn('mx-auto flex items-center gap-3 px-4 py-3', WIDTH[maxWidth])}>
        {showBackLink ? (
          <Link
            href={backHref}
            className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink/60 transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{backLabel ?? t('nav.backHome')}</span>
          </Link>
        ) : (
          <BrandMark className="text-sm" />
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          {/* Overseas employers: the one destination in the top bar besides account links. */}
          <Link
            href="/international"
            aria-label={t('nav.hireAbroad')}
            title={t('nav.hireAbroad')}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-brand/30 p-2 text-sm font-semibold text-brand-dark transition-colors hover:border-brand hover:bg-brand-light sm:px-3 sm:py-1.5"
          >
            <Globe2 className="h-4 w-4" aria-hidden />
            {/* Phones get the globe alone: the bar also holds the language switcher and Sign in. */}
            <span className="hidden sm:inline">{t('nav.hireAbroad')}</span>
          </Link>
          <LanguageSwitcher />
          {user ? (
            <>
              <Link
                href={accountHome(user)}
                className="whitespace-nowrap text-sm font-medium text-brand-dark transition-colors hover:text-brand"
                title={user.email ?? user.phone ?? undefined}
              >
                {t('nav.myAccount')}
              </Link>
              <button
                type="button"
                onClick={() => {
                  logout();
                  hardNavigate('/');
                }}
                className="whitespace-nowrap text-sm font-medium text-ink/60 transition-colors hover:text-ink"
              >
                {t('nav.signOut')}
              </button>
            </>
          ) : (
            <Link href="/login" className="whitespace-nowrap text-sm font-medium text-ink/60 transition-colors hover:text-ink">
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
