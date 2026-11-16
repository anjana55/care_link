import { addDays } from './bookings';

/**
 * When a booking's client is billed.
 * - AFTER    for the work done: a running booking month by month once the month has ended, a finished one in full.
 * - ADVANCE  for the work booked: the booking's first month as soon as it is confirmed, then each
 *            month a few days before it begins.
 *
 * It is set on each booking; new bookings take the default in Settings > Billing.
 * Either way a shift is billed once, and a shift billed in advance that does
 * not happen is put right with a correction (a credit on the next invoice).
 */
export const BILLING_TIMINGS = ['AFTER', 'ADVANCE'] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];

/** How many days before a month begins its advance invoice goes out. */
export const ADVANCE_INVOICE_LEAD_DAYS = 5;

export interface BillingPeriod {
  periodStart: string;
  periodEnd: string;
}

const firstOf = (ym: string) => `${ym}-01`;
function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
const lastOf = (ym: string) => addDays(firstOf(nextMonth(ym)), -1);

/**
 * The periods of a booking that are due to be billed in advance on `today`
 * (all dates YYYY-MM-DD, Sri Lanka's calendar):
 *
 * - the month the booking is in now - or, for one that has not started, the
 *   month it starts in - from the booking's first day in it to its last;
 * - the month after that, once it is `leadDays` or fewer away.
 *
 * Earlier months are not here: work done in them is billed after, as always.
 * What is already on an invoice is left out when the invoice is built, so a
 * period returned here may well have nothing left to bill.
 */
export function advancePeriods(booking: { startDate: string; endDate: string }, today: string, leadDays = ADVANCE_INVOICE_LEAD_DAYS): BillingPeriod[] {
  if (booking.endDate < booking.startDate) return [];
  const thisMonth = today.slice(0, 7);
  const first = booking.startDate.slice(0, 7) > thisMonth ? booking.startDate.slice(0, 7) : thisMonth;
  const out: BillingPeriod[] = [];
  for (const month of [first, nextMonth(first)]) {
    if (month !== first && today < addDays(firstOf(month), -leadDays)) continue;
    const periodStart = booking.startDate > firstOf(month) ? booking.startDate : firstOf(month);
    const periodEnd = booking.endDate < lastOf(month) ? booking.endDate : lastOf(month);
    if (periodStart <= periodEnd) out.push({ periodStart, periodEnd });
  }
  return out;
}
