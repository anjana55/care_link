'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary. Without this, an exception in any page renders
 * Next's built-in error screen - which carries none of this app's styling and
 * offers no way back into the product.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const { t } = useTranslation();

  useEffect(() => {
    // Surfaces the real cause in the browser console and in any error reporter
    // attached to the window, instead of only in the server log.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-danger-light">
            <AlertTriangle className="h-7 w-7 text-danger" aria-hidden />
          </div>

          <h1 className="mt-6 text-2xl font-bold text-ink">{t('errorBoundary.title')}</h1>
          <p className="mt-2 text-sm text-ink/60">{t('errorBoundary.body')}</p>

          {error.digest && (
            <p className="mt-3 break-all text-xs text-ink/40">
              {t('errorBoundary.reference')}: {error.digest}
            </p>
          )}

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="rounded bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              {t('errorBoundary.retry')}
            </button>
            <Link
              href="/"
              className="rounded border border-border bg-white px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              {t('notFound.home')}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
