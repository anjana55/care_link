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

/** How many days before a month begins its advance invoice goes out: the default for Settings > Billing. */
export const ADVANCE_INVOICE_LEAD_DAYS = 5;
/** The range staff can set it to. At most 28, so it never reaches back past the start of the month before. */
export const ADVANCE_INVOICE_LEAD_LIMITS = { min: 1, max: 28 } as const;

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

/**
 * Payment before confirmation. A booking billed in advance is confirmed once
 * its first invoice is paid; staff can confirm it without, giving a reason.
 * - NOT_BILLED  the first invoice has not been sent
 * - UNPAID      it has been sent (or is still a draft) and is not fully paid
 * - PAID        it is paid: the booking can be confirmed
 */
export type AdvancePaymentState = 'NOT_BILLED' | 'UNPAID' | 'PAID';

export interface AdvancePayment {
  /** True for a draft billed in advance: confirming it needs the payment, or a staff override. */
  required: boolean;
  state: AdvancePaymentState;
  /** The first invoice, once there is one. `number` is null while it is a draft. */
  invoice: { id: string; number: string | null; status: 'DRAFT' | 'ISSUED' | 'PAID'; total: string; dueDate: string | null } | null;
}

/** How close to its first day an unpaid booking is brought to staff, whatever the invoice's due date. */
export const UNPAID_ALERT_DAYS_BEFORE_START = 2;

/**
 * Visits paused for payment: a confirmed booking billed in advance whose
 * month's invoice is past its due date and unpaid. Its shifts stay on the
 * roster but nobody is sent: the caregiver is told not to go, check-in is
 * refused and the live-care agent leaves them alone. Paying the invoice
 * resumes the visits; staff can resume them without payment, with a reason.
 */
export interface PaymentHold {
  invoiceId: string;
  invoiceNumber: string | null;
  /** When the visits were paused (ISO). */
  since: string;
  dueDate: string | null;
  /** What is still owed on that invoice. */
  balance: string;
}

/** What the client can pay now: the invoice a booking waits for, and whether it can be paid online here. */
export interface PayableInvoice {
  id: string;
  number: string | null;
  total: string;
  balance: string;
  dueDate: string | null;
  canPayOnline: boolean;
}
