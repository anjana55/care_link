'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

// One definition of a locale, shared with apps/api's resolveLocale.
export type { Locale } from '@care-platform/shared';
import { DEFAULT_COMPANY_NAME, LOCALES, type Locale } from '@care-platform/shared';

const DICTIONARIES: Record<Locale, Record<string, unknown>> = { en, si, ta };
const FONT_CLASS: Record<Locale, string> = { en: 'font-sans', si: 'font-sinhala', ta: 'font-tamil' };
const STORAGE_KEY = 'care-platform-locale';
// `{brand}` in the dictionaries is the company name; BrandingProvider passes the configured one.
const DEFAULT_VARS = { brand: DEFAULT_COMPANY_NAME };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** `{name}` placeholders in the text are filled from `vars`; a missing one is left as written. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  fontClass: string;
  /** The languages this deployment offers (Settings > Branding), in display order. */
  availableLocales: Locale[];
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

export interface I18nProviderProps {
  children: ReactNode;
  /** Used when the user has not chosen a language, or chose one no longer offered. */
  defaultLocale?: Locale;
  /** The languages offered; anything else is never shown. Defaults to all of them. */
  enabledLocales?: Locale[];
  /** Placeholders every string can use without passing them - the company name as `{brand}`. */
  vars?: Record<string, string | number>;
}

export function I18nProvider({ children, defaultLocale = 'en', enabledLocales, vars }: I18nProviderProps) {
  const enabledKey = (enabledLocales?.length ? enabledLocales : LOCALES).join(',');
  const offered = useMemo<Locale[]>(() => {
    const list = enabledKey.split(',') as Locale[];
    return list.includes(defaultLocale) ? list : [defaultLocale, ...list];
  }, [defaultLocale, enabledKey]);
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    let stored: Locale | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    } catch {
      /* storage blocked - use the default */
    }
    const chosen = stored && offered.includes(stored) ? stored : defaultLocale;
    setLocaleState(chosen);
    // A language the operator has switched off is forgotten, so API calls
    // (which send the stored language) stop asking for it too.
    if (stored && stored !== chosen) {
      try {
        window.localStorage.setItem(STORAGE_KEY, chosen);
      } catch {
        /* ignore */
      }
    }
    document.documentElement.lang = chosen;
  }, [offered, defaultLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (!offered.includes(next)) return;
      setLocaleState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      document.documentElement.lang = next;
    },
    [offered],
  );

  // Keyed by content, so a caller passing a fresh object each render does not re-create t.
  const varsKey = JSON.stringify(vars ?? {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaults = useMemo(() => vars ?? {}, [varsKey]);
  const t = useCallback(
    (key: string, callVars?: Record<string, string | number>) => {
      const text = resolve(DICTIONARIES[locale], key) ?? resolve(DICTIONARIES.en, key) ?? key;
      const all: Record<string, string | number> = { ...DEFAULT_VARS, ...defaults, ...callVars };
      return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in all ? String(all[name]) : match));
    },
    [locale, defaults],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, fontClass: FONT_CLASS[locale], availableLocales: offered }),
    [locale, setLocale, t, offered],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslation must be used within I18nProvider');
  return ctx;
}
