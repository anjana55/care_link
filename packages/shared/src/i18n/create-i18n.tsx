'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
// The one definition of a locale: `types/locale.ts` also carries
// `resolveLocale`, which the API uses to narrow a client-supplied locale before
// it can reach the database as a column name. Re-exported rather than
// redeclared, so the three locales cannot drift apart between the two apps.
import { LOCALES, type Locale } from '../types/locale';

export type { Locale };
export const SUPPORTED_LOCALES: Locale[] = [...LOCALES];

/**
 * Generic i18n engine extracted from apps/web's original provider so both
 * frontends run the same locale-switching logic instead of two copies of it.
 * Each app supplies its own dictionaries (their string sets differ - a staff
 * dashboard and a public search page don't share much vocabulary) via
 * createI18n(); only the mechanism is shared, not the strings themselves.
 */

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  fontClass: string;
  /** The languages this deployment offers (Settings > Branding), in display order. */
  availableLocales: Locale[];
}

export interface I18nProviderProps {
  children: ReactNode;
  /** Used when the visitor has not chosen a language, or chose one no longer offered. */
  defaultLocale?: Locale;
  /** The languages offered; anything else is never shown. Defaults to all of them. */
  enabledLocales?: Locale[];
  /**
   * Placeholders every string can use without the caller passing them - the
   * company name as `{brand}`, so a white-labelled deployment never says
   * the product's own name.
   */
  vars?: Record<string, string | number>;
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
export function createI18n(
  dictionaries: Record<Locale, Record<string, unknown>>,
  storageKey: string,
  /** Placeholders filled when the provider is given none, e.g. `{ brand: 'CareLink' }`. */
  defaultVars: Record<string, string | number> = {},
) {
  const I18nContext = createContext<I18nContextValue | null>(null);

  function I18nProvider({ children, defaultLocale = 'en', enabledLocales, vars }: I18nProviderProps) {
    const offered = useMemo<Locale[]>(() => {
      const list = (enabledLocales?.length ? enabledLocales : LOCALES).filter((l) => dictionaries[l]);
      return list.includes(defaultLocale) ? list : [defaultLocale, ...list];
      // A new array each render from the caller must not reset the locale.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultLocale, (enabledLocales ?? LOCALES).join(',')]);
    const [locale, setLocaleState] = useState<Locale>(defaultLocale);

    useEffect(() => {
      let stored: Locale | null = null;
      try {
        stored = window.localStorage.getItem(storageKey) as Locale | null;
      } catch {
        /* storage blocked - use the default */
      }
      const chosen = stored && offered.includes(stored) ? stored : defaultLocale;
      setLocaleState(chosen);
      if (stored && stored !== chosen) {
        // A language the operator has switched off: forget it, so API calls stop asking for it too.
        try {
          window.localStorage.setItem(storageKey, chosen);
        } catch {
          /* ignore */
        }
      }
      if (typeof document !== 'undefined') document.documentElement.lang = chosen;
    }, [offered, defaultLocale]);

    const setLocale = useCallback(
      (next: Locale) => {
        if (!offered.includes(next)) return;
        setLocaleState(next);
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          /* ignore */
        }
        if (typeof document !== 'undefined') {
          document.documentElement.lang = next;
        }
      },
      [offered],
    );

    const varsKey = JSON.stringify(vars ?? {});
    const t = useCallback(
      (key: string, callVars?: Record<string, string | number>) => {
        const template = resolve(dictionaries[locale], key) ?? resolve(dictionaries.en, key) ?? key;
        return interpolate(template, { ...defaultVars, ...vars, ...callVars });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [locale, varsKey],
    );

    const value = useMemo(
      () => ({ locale, setLocale, t, fontClass: FONT_CLASS[locale], availableLocales: offered }),
      [locale, setLocale, t, offered],
    );

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
  }

  function useTranslation(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useTranslation must be used within its matching I18nProvider');
    return ctx;
  }

  return { I18nProvider, useTranslation };
}
