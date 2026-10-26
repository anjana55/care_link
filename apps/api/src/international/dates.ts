/** Today's date in Sri Lanka (UTC+05:30), YYYY-MM-DD: the office's calendar day. */
export const todayColombo = (now = Date.now()) => new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);

/** YYYY-MM-DD plus whole days (negative to go back). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus whole months, clamped to the month's last day (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** A DATE column as YYYY-MM-DD, whether the driver gave a string or a Date. */
export const dateOnly = (v: string | Date | null | undefined): string | null => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));
