import { COLOMBO_TIME_ZONE } from '@care-platform/shared';
import type { Locale } from '@care-platform/shared';

/**
 * Display helpers for shift times. Every time shown in the staff app is
 * Colombo time - whatever zone the browser happens to be in - because that is
 * where the care happens and what the caregiver and client hear on the phone.
 */
const tag = (locale: Locale) => (locale === 'en' ? 'en-GB' : `${locale}-LK`);

export const fmtDay = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(tag(locale), { timeZone: COLOMBO_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));

export const fmtTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(tag(locale), { timeZone: COLOMBO_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

export const fmtDateTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(tag(locale), { timeZone: COLOMBO_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** 'YYYY-MM-DD' -> a readable date, no time zone involved. */
export const fmtDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(tag(locale), { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));

/** ISO weekday (1 = Monday) -> its short name. */
export const fmtWeekday = (isoWeekday: number, locale: Locale) =>
  new Intl.DateTimeFormat(tag(locale), { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2026, 9, 18 + isoWeekday)));
