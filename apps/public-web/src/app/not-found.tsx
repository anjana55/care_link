import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { getDictionary, translate } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'Page not found — CareLink',
};

export default function NotFound() {
  // not-found.tsx can be rendered outside the client I18nProvider, so it reads
  // the dictionary directly instead of using the useTranslation() hook.
  const dict = getDictionary('en');
  const t = (key: string) => translate(dict, key);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-light">
            <SearchX className="h-7 w-7 text-brand" aria-hidden />
          </div>

          <h1 className="mt-6 text-2xl font-bold text-ink">{t('notFound.title')}</h1>
          <p className="mt-2 text-sm text-ink/60">{t('notFound.body')}</p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="rounded border border-border bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              {t('notFound.home')}
            </Link>
            <Link
              href="/find"
              className="rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              {t('notFound.search')}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
