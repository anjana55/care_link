/**
 * The languages the API can answer in. Matches the web apps' dictionaries.
 * English is both the default and the language every message is written in.
 */
export const SUPPORTED_LANGUAGES = ['en', 'si', 'ta'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

const toLanguage = (tag: string | undefined | null): Language | null => {
  if (!tag) return null;
  // `si-LK`, `ta_IN` and `SI` all mean their primary subtag.
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? (primary as Language) : null;
};

/** `si-LK,si;q=0.9,en;q=0.8` -> languages in the caller's order of preference. */
function fromAcceptLanguage(header: string | undefined): Language | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const language = toLanguage(tag);
    if (language) return language;
  }
  return null;
}

/**
 * Which language to answer in.
 *
 * An explicit `?lang=` wins, because it is the caller saying so; otherwise the
 * standard Accept-Language header; otherwise English. An unsupported value is
 * ignored rather than rejected: a message in the wrong language is a nuisance,
 * a 400 on a language preference would be a bug in its own right.
 */
export function resolveLanguage(queryLang: unknown, acceptLanguage: string | undefined): Language {
  const fromQuery = typeof queryLang === 'string' ? toLanguage(queryLang) : null;
  return fromQuery ?? fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LANGUAGE;
}
