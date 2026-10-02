'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';

/**
 * The footer carries the search-result disclaimer plus the same set of
 * destinations the landing page links to, so no page in the app is a dead end.
 *
 * /api/docs leaves this app entirely - it is served by the API container, not
 * by Next - so it is a plain anchor. next/link would try to route it through
 * the app router and 404.
 */
export function SiteFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm"
          aria-label={t('footer.navLabel')}
        >
          <Link href="/find" className="text-ink/70 transition-colors hover:text-brand">
            {t('footer.finder')}
          </Link>
          <Link href="/register" className="text-ink/70 transition-colors hover:text-brand">
            {t('nav.signUp')}
          </Link>
          <Link href="/login" className="text-ink/70 transition-colors hover:text-brand">
            {t('nav.signIn')}
          </Link>
          <a href="/api/docs" className="text-ink/70 transition-colors hover:text-brand">
            {t('footer.apiDocs')}
          </a>
        </nav>

        <p className="mx-auto mt-5 max-w-2xl text-center text-xs text-ink/40">{t('footer.disclaimer')}</p>
      </div>
    </footer>
  );
}
