'use client';

import { useTranslation, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const LABELS: Record<Locale, string> = { en: 'EN', si: 'සිං', ta: 'த' };

/** Shows only the languages offered in Settings > Branding, and nothing when there is just one. */
export function LanguageSwitcher() {
  const { t, locale, setLocale, availableLocales } = useTranslation();
  if (availableLocales.length < 2) return null;

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-1" role="group" aria-label={t('common.language')}>
      {availableLocales.map((code) => (
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
