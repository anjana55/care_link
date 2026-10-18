'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n';
import { rememberReturnTo } from '@/lib/return-to';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

const SECTIONS = [
  { href: '/account/requests', key: 'account.nav.requests' },
  { href: '/account/saved', key: 'account.nav.saved' },
];

/**
 * The signed-in client's area: their requests and saved caregivers.
 *
 * Guarded here for every page under it. A visitor who is signed out is sent to
 * sign in and brought back; a caregiver session goes to the caregiver's own
 * area. The API scopes every call to the caller as well - this is about not
 * rendering a page that can only fail, not about protecting data.
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (pathname) rememberReturnTo(pathname);
      router.replace('/login');
    } else if (user.role !== 'PATIENT_GUARDIAN') {
      router.replace('/caregiver/dashboard');
    }
  }, [loading, user, router, pathname]);

  const ready = !loading && user?.role === 'PATIENT_GUARDIAN';

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader maxWidth="3xl" backHref="/find" backLabel={t('account.findCaregivers')} />
      {ready ? (
        <>
          <nav aria-label={t('account.navLabel')} className="border-b border-border bg-white">
            <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4">
              {SECTIONS.map((section) => {
                const active = pathname === section.href;
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    aria-current={active ? 'page' : undefined}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                      active ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink'
                    }`}
                  >
                    {t(section.key)}
                  </Link>
                );
              })}
            </div>
          </nav>
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-ink/60">{t('common.loading')}</p>
        </div>
      )}
      <SiteFooter />
    </div>
  );
}
