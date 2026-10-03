/**
 * The three languages the platform ships, in one place.
 *
 * Both frontends and the API need to agree on this list, and each of them
 * otherwise keeps its own copy - which is how the API ends up being asked for
 * a locale it has no column for. Anything that takes a locale from a browser
 * goes through {@link resolveLocale} rather than casting.
 */
export const LOCALES = ['en', 'si', 'ta'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Narrows anything to a supported locale, falling back to English.
 *
 * Safe to call on a query parameter: the endpoints that take a locale are all
 * public, so the value is attacker-controlled, and falling back to a column
 * that exists is the only thing that stops an arbitrary string from reaching
 * the database layer as an identifier.
 */
export function resolveLocale(raw: unknown): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
}
