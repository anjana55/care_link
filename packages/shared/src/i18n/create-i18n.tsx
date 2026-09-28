'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';

/**
 * Generic i18n engine extracted from apps/web's original provider so both
 * frontends run the same locale-switching logic instead of two copies of it.
 * Each app supplies its own dictionaries (their string sets differ - a staff
 * dashboard and a public search page don't share much vocabulary) via
 * createI18n(); only the mechanism is shared, not the strings themselves.
 */

export type Locale = 'en' | 'si' | 'ta';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'si', 'ta'];

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  fontClass: string;
}

const FONT_CLASS: Record<Locale, string> = {
  en: 'font-sans',
  si: 'font-sinhala',
  ta: 'font-tamil',
};

function resolve(dict: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Builds an isolated I18nProvider/useTranslation pair bound to the given
 * dictionaries. Each app calls this once (with its own en/si/ta JSON) and
 * exports the result - keeps two independent locale contexts from colliding
 * if a component tree ever nested one app's provider inside the other's.
 */
export function createI18n(dictionaries: Record<Locale, Record<string, unknown>>, storageKey: string) {
  const I18nContext = createContext<I18nContextValue | null>(null);

  function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>('en');

    useEffect(() => {
      const stored = window.localStorage.getItem(storageKey) as Locale | null;
      if (stored && dictionaries[stored]) setLocaleState(stored);
    }, []);

    const setLocale = useCallback((next: Locale) => {
      setLocaleState(next);
      window.localStorage.setItem(storageKey, next);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next;
      }
    }, []);

    const t = useCallback(
      (key: string, vars?: Record<string, string | number>) => {
        const template = resolve(dictionaries[locale], key) ?? resolve(dictionaries.en, key) ?? key;
        return interpolate(template, vars);
      },
      [locale],
    );

    const value = useMemo(() => ({ locale, setLocale, t, fontClass: FONT_CLASS[locale] }), [locale, setLocale, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
  }

  function useTranslation(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useTranslation must be used within its matching I18nProvider');
    return ctx;
  }

  return { I18nProvider, useTranslation };
}
