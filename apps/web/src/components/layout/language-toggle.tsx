'use client';

import { useTranslation, type Locale } from '@/lib/i18n/provider';

const LABELS: Record<Locale, string> = { en: 'EN', si: 'සිං', ta: 'தமி' };

/**
 * The EN / සිං / தமி switch in the staff and caregiver headers. Shows only
 * the languages offered in Settings > Branding, and nothing at all when there
 * is just one to choose.
 */
export function LanguageToggle() {
  const { locale, setLocale, availableLocales, t } = useTranslation();
  if (availableLocales.length < 2) return null;

  return (
    <div className="flex overflow-hidden rounded border border-border" role="group" aria-label={t('common.language')}>
      {availableLocales.map((code) => (
        <button
          key={code}
          onClick={() => setLocale(code)}
          className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
            locale === code ? 'bg-brand text-white' : 'bg-white text-ink/60 hover:bg-paper'
          }`}
          aria-pressed={locale === code}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
