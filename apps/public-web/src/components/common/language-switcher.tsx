'use client';

import { SUPPORTED_LOCALES, useTranslation, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const LABELS: Record<Locale, string> = { en: 'EN', si: 'සිං', ta: 'த' };

export function LanguageSwitcher() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-1" role="group" aria-label="Language">
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-pressed={locale === code}
          className={cn(
            'rounded-DEFAULT px-2.5 py-1 text-sm font-medium transition-colors',
            locale === code ? 'bg-brand text-white' : 'text-ink/70 hover:bg-brand-light',
          )}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
