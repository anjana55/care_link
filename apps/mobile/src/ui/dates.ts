import { toColombo } from '@care-platform/shared';

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


/**
 * Shift times are always Sri Lanka time, whatever zone the phone is in:
 * that's where the care happens and what everyone hears on the phone.
 * Worked out without Intl time zones, which not every Android build has.
 */
export const fmtTime = (iso: string) => toColombo(iso).time;

/** A shift's day in Sri Lanka, e.g. "Mon, 2 Nov". */
export function fmtDay(iso: string, locale: string): string {
  const { date } = toColombo(iso);
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
