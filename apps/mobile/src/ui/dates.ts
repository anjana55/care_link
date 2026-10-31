/** A date (YYYY-MM-DD or an ISO time) the way the app's reader writes it, e.g. 2 Nov 2026. */
export function formatDate(value: string, locale: string): string {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale === 'en' ? 'en-GB' : locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(value.length === 10 ? { timeZone: 'UTC' } : { timeZone: 'Asia/Colombo' }),
  });
}
