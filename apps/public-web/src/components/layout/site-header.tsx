'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Globe2, LogOut, Menu, UserRound, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { BrandMark } from '@/components/layout/brand-mark';
import { useAuth } from '@/lib/api/auth-context';
import { accountHome } from '@/lib/account-home';
import { cn } from '@/lib/utils';
import { hardNavigate } from '@/lib/navigation';
import { NotificationBell } from '@/components/notifications/notification-bell';

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
  const signOut = () => {
    logout();
    hardNavigate('/');
  };

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

        {/*
          Signed in, the bar would hold six things - too many for a phone - so
          there the bell stays and the rest fold into one labelled menu. Signed
          out it holds three and stays as it is.
        */}
        <div className={cn('items-center gap-3', user ? 'hidden sm:flex' : 'flex')}>
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
          {!user && (
            <Link href="/login" className="whitespace-nowrap text-sm font-medium text-ink/60 transition-colors hover:text-ink">
              {t('nav.signIn')}
            </Link>
          )}
        </div>
        {user && (
          <>
            {/* One bell, on every width: it sits between the two groups that fold away on a phone. */}
            <NotificationBell />
            <div className="hidden items-center gap-3 sm:flex">
              <Link
                href={accountHome(user)}
                className="whitespace-nowrap text-sm font-medium text-brand-dark transition-colors hover:text-brand"
                title={user.email ?? user.phone ?? undefined}
              >
                {t('nav.myAccount')}
              </Link>
              <button type="button" onClick={signOut} className="whitespace-nowrap text-sm font-medium text-ink/60 transition-colors hover:text-ink">
                {t('nav.signOut')}
              </button>
            </div>
            <PhoneMenu accountHref={accountHome(user)} onSignOut={signOut} />
          </>
        )}
      </div>
    </header>
  );
}

const ROW = 'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-medium text-ink hover:bg-paper';

/**
 * The signed-in header on a phone: beside the bell, a Menu button that opens
 * everything else as full-width rows with words, not icons to guess at -
 * My account, Hire from Sri Lanka, the language, Sign out.
 */
function PhoneMenu({ accountHref, onSignOut }: { accountHref: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Open only: a tap anywhere else, or Esc, closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-phone-menu"
        aria-label={open ? t('nav.closeMenu') : t('nav.openMenu')}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-white text-ink/70 hover:bg-paper hover:text-ink"
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <div id="site-phone-menu" className="absolute inset-x-0 top-full border-b border-border bg-white p-3 shadow-lg">
          <Link href={accountHref} onClick={() => setOpen(false)} className={ROW}>
            <UserRound className="h-5 w-5 text-brand-dark" aria-hidden />
            {t('nav.myAccount')}
          </Link>
          <Link href="/international" onClick={() => setOpen(false)} className={ROW}>
            <Globe2 className="h-5 w-5 text-brand-dark" aria-hidden />
            {t('nav.hireAbroad')}
          </Link>
          <div className="flex min-h-12 items-center justify-between gap-3 px-3">
            <span className="text-base font-medium text-ink">{t('common.language')}</span>
            <LanguageSwitcher />
          </div>
          <button type="button" onClick={onSignOut} className={cn(ROW, 'mt-1 border-t border-border pt-1 text-ink/70')}>
            <LogOut className="h-5 w-5" aria-hidden />
            {t('nav.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
