'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { LanguageSwitcher } from '@/components/common/language-switcher';

const SECTIONS = [
  { href: '/caregiver/dashboard', key: 'portal.nav.overview' },
  { href: '/caregiver/profile', key: 'portal.nav.profile' },
  { href: '/caregiver/documents', key: 'portal.nav.documents' },
  { href: '/caregiver/shifts', key: 'portal.nav.shifts' },
];

/**
 * The signed-in caregiver's area: overview, profile, documents, shifts.
 *
 * It lives in this app rather than /staff because of the token-key split: the
 * two apps are served from one origin but keep their JWT pair under different
 * localStorage keys, so a hand-off into /staff would arrive signed out.
 *
 * Guarded once, here, for every page under it. Anyone who is not a signed-in
 * caregiver is sent away before a page renders - the API checks ownership on
 * every call as well, so this is about not showing a broken page, not about
 * protecting data.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/caregiver/login');
    else if (user.role !== 'CAREGIVER') router.replace('/');
  }, [loading, user, router]);

  if (loading || !user || user.role !== 'CAREGIVER') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <p className="text-sm text-ink/60">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-base font-semibold text-brand-dark">
            CareLink
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <span className="hidden text-xs text-ink/50 lg:inline">{user.email ?? user.phone}</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                logout();
                window.location.assign('/caregiver/login');
              }}
            >
              {t('caregiverDashboard.signOut')}
            </Button>
          </div>
        </div>
        <nav aria-label={t('portal.nav.label')} className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4">
          {SECTIONS.map((section) => {
            const active = pathname === section.href;
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
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  );
}
