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

  const tabs: { id: SearchMode; label: string; disabled: boolean }[] = [
    { id: 'normal', label: t('searchMode.normal'), disabled: false },
    { id: 'ai', label: t('searchMode.ai'), disabled: !aiEnabled },
  ];
  // AI Search is the default when it is on, so it comes first; when it is off
  // it sits last, greyed out, behind the mode that actually works.
  if (aiEnabled) tabs.reverse();

  return (
    <div>
      <div className="inline-flex rounded-lg border border-border bg-white p-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            className={cn(
              'rounded-DEFAULT px-4 py-2 text-sm font-semibold transition-colors',
              mode === tab.id ? 'bg-brand text-white' : 'text-ink/70 hover:bg-brand-light',
              tab.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {!aiEnabled && <p className="mt-2 text-xs text-ink/50">{t('searchMode.aiUnavailable')}</p>}
    </div>
  );
}
