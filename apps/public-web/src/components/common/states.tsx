'use client';

import { Loader2, SearchX, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink/70" role="status" aria-live="polite">
      <Loader2 className="h-8 w-8 animate-spin text-brand" aria-hidden />
      <p>{label}</p>
    </div>
  );
}

export function EmptyResultsState({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-white py-16 text-center">
      <SearchX className="h-8 w-8 text-ink/40" aria-hidden />
      <h3 className="text-lg font-semibold">{t('empty.title')}</h3>
      <p className="max-w-sm text-sm text-ink/60">{t('empty.subtitle')}</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 rounded-DEFAULT border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-light"
      >
        {t('empty.action')}
      </button>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger-light py-16 text-center"
      role="alert"
    >
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden />
      <h3 className="text-lg font-semibold text-danger">{t('error.title')}</h3>
      <p className="max-w-sm text-sm text-ink/70">{t('error.subtitle')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded-DEFAULT bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        {t('error.retry')}
      </button>
    </div>
  );
}
