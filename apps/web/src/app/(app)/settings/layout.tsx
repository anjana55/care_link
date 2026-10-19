'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { settingsSectionsFor } from '@/lib/settings-sections';

/**
 * The Settings area: the white-label branding, AI, how people sign in, how
 * they are reached and billed - and the reference data (skills, languages,
 * locations) and the audit log.
 *
 * Which tabs a role sees comes from settingsSectionsFor(): admins see
 * everything; staff and verifiers see the reference data only, read-only,
 * as they did when those pages sat in the sidebar. A section a role cannot
 * open sends them to the first one they can (the pages keep their own guards
 * as well - a section added later should not be one forgotten check away from
 * being visible to the wrong role).
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sections = settingsSectionsFor(user?.role);
  const allowed = sections.some((s) => pathname?.startsWith(s.href));

  useEffect(() => {
    if (loading || !user) return;
    if (!sections.length) router.replace('/dashboard');
    else if (!allowed) router.replace(sections[0].href);
  }, [loading, user, sections, allowed, pathname, router]);

  if (loading || !user || !allowed) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-ink">{t('settings.title')}</h1>
      <p className="mb-5 text-sm text-ink/60">{user.role === 'ADMIN' ? t('settings.subtitle') : t('settings.subtitleStaff')}</p>
      <nav aria-label={t('settings.title')} className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {sections.map((section) => {
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
