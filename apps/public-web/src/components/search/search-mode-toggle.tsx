'use client';

import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type SearchMode = 'normal' | 'ai';

interface SearchModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
  aiEnabled: boolean;
}

export function SearchModeToggle({ mode, onChange, aiEnabled }: SearchModeToggleProps) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="inline-flex rounded-lg border border-border bg-white p-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'normal'}
          onClick={() => onChange('normal')}
          className={cn(
            'rounded-DEFAULT px-4 py-2 text-sm font-semibold transition-colors',
            mode === 'normal' ? 'bg-brand text-white' : 'text-ink/70 hover:bg-brand-light',
          )}
        >
          {t('searchMode.normal')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'ai'}
          disabled={!aiEnabled}
          onClick={() => onChange('ai')}
          className={cn(
            'rounded-DEFAULT px-4 py-2 text-sm font-semibold transition-colors',
            mode === 'ai' ? 'bg-brand text-white' : 'text-ink/70 hover:bg-brand-light',
            !aiEnabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
          )}
        >
          {t('searchMode.ai')}
        </button>
      </div>
      {!aiEnabled && <p className="mt-2 text-xs text-ink/50">{t('searchMode.aiUnavailable')}</p>}
    </div>
  );
}
