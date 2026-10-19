'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/settings/branding', key: 'settings.branding' },
  { href: '/settings/social-auth', key: 'settings.socialAuth' },
  { href: '/settings/whatsapp', key: 'settings.whatsapp' },
  { href: '/settings/email', key: 'settings.email' },
  { href: '/settings/billing', key: 'settings.billing' },
];

/**
 * The admin Settings area: the white-label branding, how people sign in, how
 * they are reached and how they are billed. Every API route behind it is ADMIN-only, so the guard lives here
 * once instead of per page (the pages keep their own as well - a section added
 * later should not be one forgotten check away from being visible to staff).
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [loading, user, router]);

  if (loading || !user || user.role !== 'ADMIN') {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{t('settings.title')}</h1>
      <p className="mb-5 text-sm text-ink/60">{t('settings.subtitle')}</p>
      <nav aria-label={t('settings.title')} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {SECTIONS.map((section) => {
          const active = pathname?.startsWith(section.href);
          return (
            <Link
              key={section.href}
              href={section.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                active ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink',
              )}
            >
              {t(section.key)}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
