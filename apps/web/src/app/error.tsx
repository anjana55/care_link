'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/provider';

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();

  useEffect(() => {
    // Without this the error vanishes entirely and the boundary just re-renders
    // the same failure with no trace in the console.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-lg font-semibold text-ink">{t('errorBoundary.title')}</h1>
        <p className="mb-6 text-sm text-ink/60">{t('errorBoundary.body')}</p>
        <button
          onClick={reset}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          {t('errorBoundary.retry')}
        </button>
      </div>
    </div>
  );
}