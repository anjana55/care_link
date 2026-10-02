import en from './dictionaries/en.json';
import si from './dictionaries/si.json';
import ta from './dictionaries/ta.json';

/**
 * Dictionary access for Server Components.
 *
 * The client-side `useTranslation()` hook needs a React context, so it is
 * unavailable in `not-found.tsx` and other Server Components that Next may
 * render outside the provider tree. This reads the same JSON files directly.
 *
 * It returns English regardless of the stored locale: a Server Component cannot
 * read localStorage, so there is no way to honour the visitor's choice here. The
 * client boundary renders the localised version once it hydrates.
 */
const DICTIONARIES = { en, si, ta } as const;

export type ServerLocale = keyof typeof DICTIONARIES;

export function getDictionary(locale: ServerLocale = 'en') {
  return DICTIONARIES[locale];
}

/** Dotted-path lookup, matching the key style the client `t()` uses. */
export function translate(dict: Record<string, unknown>, key: string): string {
  let current: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : key;
}
