'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { useAuth } from '@/lib/api/auth-context';
import { cn } from '@/lib/utils';

interface SiteHeaderProps {
  /**
   * Content width. The finder is a wide search surface, the auth pages are
   * narrow centred cards - the shell matches whichever is being rendered.
   */
  maxWidth?: 'sm' | '3xl' | '5xl';
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
            className="flex items-center gap-1.5 text-sm font-medium text-ink/60 transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {backLabel ?? t('nav.backHome')}
          </Link>
        ) : (
          <span className="text-sm font-semibold text-brand-dark">{t('nav.brand')}</span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {user ? (
            <button
              type="button"
              onClick={logout}
              className="text-sm font-medium text-ink/60 transition-colors hover:text-ink"
            >
              {user.email ?? user.phone}
            </button>
          ) : (
            <Link href="/login" className="text-sm font-medium text-ink/60 transition-colors hover:text-ink">
              {t('nav.signIn')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
