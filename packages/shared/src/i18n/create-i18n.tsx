'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
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
  /**
   * False until the saved language has been read. In a browser that is the
   * first effect, so it barely matters; with asynchronous storage (the mobile
   * app's AsyncStorage) the first frames show `defaultLocale`, and the app
   * keeps its splash screen up until this is true rather than flashing English
   * at a Sinhala or Tamil reader on every launch.
   */
  ready: boolean;
}

/**
 * Where the chosen language is remembered. Either kind of storage fits: the
 * browser's synchronous localStorage, or the mobile app's AsyncStorage, whose
 * methods return promises. A failed read or write (storage blocked, quota,
 * private mode) is never an error for the reader - the language just isn't
 * remembered.
 */
export interface LocaleStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export interface CreateI18nOptions {
  /** Defaults to the browser's localStorage, and to no storage where there is none. */
  storage?: LocaleStorage;
  /**
   * Told the language whenever it is settled or changed, including the first
   * time the saved choice is read. Defaults to setting `<html lang>`. The mobile
   * app passes its own instead: it has no document, and its API client cannot
   * read AsyncStorage synchronously per request the way the web client reads
   * localStorage, so it keeps the language this hands it.
   */
  onLocaleChange?: (locale: Locale) => void;
}

/**
 * The browser's localStorage, read through guards. `window` alone is not
 * enough to go on: React Native defines a global `window` with no
 * localStorage on it, and server rendering has no `window` at all. In both,
 * nothing is remembered here and nothing throws.
 */
export const browserLocaleStorage: LocaleStorage = {
  getItem(key) {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  },
};

/** The default `onLocaleChange`: `<html lang>`, so screen readers and fonts follow. Does nothing without a document. */
export function setDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = locale;
}

function isPromise<T>(value: unknown): value is Promise<T> {
  return typeof (value as Promise<T> | null)?.then === 'function';
}

/**
 * Reads the saved value and hands it to `apply` - straight away when the
 * storage is synchronous, so the web apps settle their language in the same
 * effect they always did, and when the promise settles otherwise. A throw or
 * a rejection is handed over as "nothing saved".
 */
function readSaved(storage: LocaleStorage, key: string, apply: (value: string | null) => void): void {
  let result: string | null | Promise<string | null>;
  try {
    result = storage.getItem(key);
  } catch {
    result = null;
  }
  if (isPromise<string | null>(result)) {
    result.then(apply, () => apply(null));
  } else {
    apply(result);
  }
}

function writeSaved(storage: LocaleStorage, key: string, value: string): void {
  try {
    const result = storage.setItem(key, value);
    if (isPromise<void>(result)) result.catch(() => undefined);
  } catch {
    /* storage blocked - the choice holds until the app or page is closed */
  }
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
  { storage = browserLocaleStorage, onLocaleChange = setDocumentLang }: CreateI18nOptions = {},
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
    const [ready, setReady] = useState(false);
    // Counts the reader's own choices. A read that started before one of them
    // must not land after it: with AsyncStorage, tapping a language while the
    // saved one is still loading would otherwise be undone a moment later.
    const choices = useRef(0);

    useEffect(() => {
      let current = true;
      const choicesAtStart = choices.current;
      readSaved(storage, storageKey, (value) => {
        if (!current) return;
        if (choices.current !== choicesAtStart) {
          // The reader chose while this was loading; setLocale already applied and saved that.
          setReady(true);
          return;
        }
        const stored = value as Locale | null;
        const chosen = stored && offered.includes(stored) ? stored : defaultLocale;
        setLocaleState(chosen);
        // A language the operator has switched off: forget it, so API calls stop asking for it too.
        if (stored && stored !== chosen) writeSaved(storage, storageKey, chosen);
        onLocaleChange(chosen);
        setReady(true);
      });
      return () => {
        current = false;
      };
    }, [offered, defaultLocale]);

    const setLocale = useCallback(
      (next: Locale) => {
        if (!offered.includes(next)) return;
        choices.current += 1;
        setLocaleState(next);
        writeSaved(storage, storageKey, next);
        onLocaleChange(next);
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
      () => ({ locale, setLocale, t, fontClass: FONT_CLASS[locale], availableLocales: offered, ready }),
      [locale, setLocale, t, offered, ready],
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
