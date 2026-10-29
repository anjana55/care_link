'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/layout/brand-mark';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { rememberReturnTo } from '@/lib/return-to';
import { hardNavigate } from '@/lib/navigation';

const SECTIONS = [
  { href: '/employer', key: 'employer.nav.overview' },
  { href: '/employer/vacancies', key: 'employer.nav.vacancies' },
  { href: '/employer/offers', key: 'employer.nav.offers' },
  { href: '/employer/placements', key: 'employer.nav.placements' },
  { href: '/employer/shortlist', key: 'employer.nav.shortlist' },
  { href: '/international#talent', key: 'employer.nav.browse' },
  { href: '/employer/enquiries/new', key: 'employer.nav.newEnquiry' },
  { href: '/employer/account', key: 'employer.nav.account' },
];

/**
 * An overseas employer's own area. Guarded once, here: anyone who is not a
 * signed-in employer is sent to the employer sign-in (the API checks the role
 * and ownership on every call as well).
 */
export default function EmployerAreaLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      rememberReturnTo(pathname ?? '/employer');
      router.replace('/employer/login');
    } else if (user.role !== 'EMPLOYER') router.replace('/');
  }, [loading, user, router, pathname]);

  if (loading || !user || user.role !== 'EMPLOYER') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-ink/60">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper print:bg-white">
      <header className="border-b border-border bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            <BrandMark />
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="hidden text-xs text-ink/50 lg:inline">{user.email}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logout();
                hardNavigate('/employer/login');
              }}
            >
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
        <nav aria-label={t('employer.nav.label')} className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
          {SECTIONS.map((section) => {
            const active = section.href === '/employer' ? pathname === section.href : Boolean(pathname?.startsWith(section.href)) || (section.href === '/employer/placements' && Boolean(pathname?.startsWith('/employer/invoices')));
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink'
                }`}
              >
                {t(section.key)}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
