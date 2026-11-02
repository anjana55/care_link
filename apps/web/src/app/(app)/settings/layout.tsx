'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { sectionHrefFor, settingsGroupsFor } from '@/lib/settings-sections';
import { Select } from '@/components/ui/input';

/**
 * The Settings area: the white-label branding, AI, how people sign in, how
 * they are reached and billed - and the reference data (skills, languages,
 * locations) and the audit log.
 *
 * Which sections a role sees comes from settingsGroupsFor(): admins see
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
  const groups = settingsGroupsFor(user?.role);
  const sections = groups.flatMap((g) => g.sections);
  const active = sectionHrefFor(pathname);
  const allowed = sections.some((s) => s.href === active);

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
      <p className="mb-6 text-sm text-ink/60">{user.role === 'ADMIN' ? t('settings.subtitle') : t('settings.subtitleStaff')}</p>

      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        {/* Narrow screens: one grouped drop-down instead of a strip of tabs that runs off the edge. */}
        <div className="mb-6 lg:hidden">
          <label htmlFor="settings-section" className="sr-only">
            {t('settings.title')}
          </label>
          <Select id="settings-section" value={active ?? ''} onChange={(e) => router.push(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.key} label={t(g.key)}>
                {g.sections.map((s) => (
                  <option key={s.href} value={s.href}>
                    {t(s.key)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        {/* Wide screens: the sections listed down the side, in groups. */}
        <nav aria-label={t('settings.title')} className="hidden lg:block">
          <div className="sticky top-6 space-y-4">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink/45">{t(g.key)}</p>
                <ul className="space-y-0.5">
                  {g.sections.map((s) => {
                    const current = s.href === active;
                    return (
                      <li key={s.href}>
                        <Link
                          href={s.href}
                          aria-current={current ? 'page' : undefined}
                          className={cn(
                            'block rounded px-3 py-1 text-sm transition-colors',
                            current ? 'bg-brand-light font-medium text-brand-dark' : 'text-ink/70 hover:bg-paper hover:text-ink',
                          )}
                        >
                          {t(s.key)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
