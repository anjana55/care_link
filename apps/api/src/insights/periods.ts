import { addDays, type InsightBucket, type InsightRange } from '@care-platform/shared';

/**
 * The dashboard's time windows, all in Asia/Colombo calendar days.
 *
 *  30d  the last 30 days, one bucket per day;           compared with the 30 days before
 *  90d  the last 13 weeks (91 days), one bucket a week; compared with the 13 weeks before
 *  12m  this month and the 11 before it, one a month;   compared with the same span a year earlier
 *
 * 12m compares with "the same dates last year" rather than "the 12 months
 * before" because the current month is only partly over - a full prior month
 * would make every month-to-date look like a decline.
 *
 * Pure, so it is unit-tested.
 */
export interface InsightPeriod {
  range: InsightRange;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  unit: 'day' | 'week' | 'month';
  buckets: InsightBucket[];
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

function addMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${date.slice(8, 10)}`;
}

/** Same calendar day a year earlier; 29 Feb falls back to 28 Feb. */
function minusYear(date: string): string {
  const y = Number(date.slice(0, 4)) - 1;
  const md = date.slice(5) === '02-29' ? '02-28' : date.slice(5);
  return `${y}-${md}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function periodFor(range: InsightRange, today: string): InsightPeriod {
  if (range === '12m') {
    const from = monthStart(addMonths(today, -11));
    const buckets: InsightBucket[] = [];
    for (let i = 0; i < 12; i++) {
      const start = addMonths(from, i);
      const end = i === 11 ? today : addDays(addMonths(from, i + 1), -1);
      buckets.push({ start, end });
    }
    return { range, from, to: today, prevFrom: minusYear(from), prevTo: minusYear(today), unit: 'month', buckets };
  }

  const days = range === '30d' ? 30 : 91;
  const step = range === '30d' ? 1 : 7;
  const from = addDays(today, -(days - 1));
  const buckets: InsightBucket[] = [];
  for (let start = from; start <= today; start = addDays(start, step)) {
    buckets.push({ start, end: addDays(start, step - 1) });
  }
  return {
    range,
    from,
    to: today,
    prevFrom: addDays(from, -days),
    prevTo: addDays(from, -1),
    unit: range === '30d' ? 'day' : 'week',
    buckets,
  };
}

/** Which bucket a day falls in, or -1 outside the period. */
export function bucketOf(period: InsightPeriod, date: string): number {
  if (date < period.from || date > period.to) return -1;
  if (period.unit === 'month') {
    const months = (Number(date.slice(0, 4)) - Number(period.from.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(period.from.slice(5, 7));
    return months;
  }
  return Math.floor(daysBetween(period.from, date) / (period.unit === 'week' ? 7 : 1));
}

export interface DailyValue {
  day: string;
  value: number;
}

/**
 * Folds per-day values (spanning the previous and current periods) into the
 * current period's buckets plus the two period totals.
 */
export function fold(period: InsightPeriod, rows: DailyValue[]): { series: number[]; total: number; previous: number } {
  const series = period.buckets.map(() => 0);
  let total = 0;
  let previous = 0;
  for (const { day, value } of rows) {
    const i = bucketOf(period, day);
    if (i >= 0) {
      series[i] += value;
      total += value;
    } else if (day >= period.prevFrom && day <= period.prevTo) {
      previous += value;
    }
  }
  return { series: series.map(round2), total: round2(total), previous: round2(previous) };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function ratio(numerator: number, denominator: number) {
  return { value: denominator > 0 ? numerator / denominator : null, numerator: round2(numerator), denominator: round2(denominator) };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
