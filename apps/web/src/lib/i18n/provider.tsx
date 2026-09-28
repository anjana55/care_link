'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

export type Locale = 'en' | 'si' | 'ta';

const DICTIONARIES: Record<Locale, Record<string, unknown>> = { en, si, ta };
const FONT_CLASS: Record<Locale, string> = { en: 'font-sans', si: 'font-sinhala', ta: 'font-tamil' };
const STORAGE_KEY = 'care-platform-locale';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  fontClass: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function resolve(dict: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = dict;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && DICTIONARIES[stored]) setLocaleState(stored);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string) => {
      return resolve(DICTIONARIES[locale], key) ?? resolve(DICTIONARIES.en, key) ?? key;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t, fontClass: FONT_CLASS[locale] }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}
