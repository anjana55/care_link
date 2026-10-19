import { addDays, daysInclusive, fromCents, roundHalfAway, shiftHours, toCents, toColombo, type BillingUnit, type RateType, type ShiftStatus } from '@care-platform/shared';
import type { CareRequestLanguage } from '../database/schema';

/**
 * Turns shifts into priced lines, for an invoice (the client's rate) or a
 * payout statement (the caregiver's pay rate). Pure - no database - so the
 * billing rules can be read, and tested, in one place:
 *
 * - A shift belongs to the Colombo day it starts on; only shifts starting in
 *   the period, in one of the wanted statuses, are billed.
 * - HOURLY: one line per shift, its hours (to two places) x the rate.
 * - DAILY:  one line per shift, one day x the rate (a "day" is a shift).
 * - MONTHLY: one line per booking for the part of the period the booking runs:
 *   every whole calendar month counts as 1, a part-month as days/30. Billed
 *   only if at least one wanted shift falls in that part. On a payout, cover
 *   shifts on a monthly booking are paid per shift at the monthly rate / 30.
 * - A shift with its own rate (set on the booking's roster) is priced at that
 *   rate instead of the booking's: HOURLY by its hours, DAILY as one shift.
 *   Shifts folded into a monthly line are priced by the month, so any rate of
 *   their own is not used there.
 * - No rate on the booking or the shift: the lines still come, priced at zero,
 *   and are counted in `unpriced` so the editor can say so.
 * - Anything already on another live invoice (or statement) is left out and
 *   counted in `skipped`: a shift by its id, a monthly line by its dates.
 */

export interface LineBooking {
  id: string;
  reference: string;
  caregiverId: string;
  startDate: string;
  endDate: string;
  rateType: RateType | null;
  rateAmount: string | null;
}

export interface LineShift {
  id: string;
  bookingId: string;
  caregiverId: string;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  /**
   * The shift's own rate for this side (the client's on an invoice, the pay
   * rate on a payout), when it has one. Null or absent = the booking's rate.
   */
  rateType?: 'HOURLY' | 'DAILY' | null;
  rateAmount?: string | null;
}

export interface BilledPeriod {
  bookingId: string;
  periodStart: string;
  periodEnd: string;
}

export interface BuiltLine {
  kind: 'SHIFT';
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  shiftId: string | null;
  bookingId: string;
  caregiverId: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface BuildInput {
  mode: 'INVOICE' | 'PAYOUT';
  /** Language of the generated descriptions (invoices). Payout descriptions are language-neutral. */
  language: CareRequestLanguage;
  from: string;
  to: string;
  statuses: readonly ShiftStatus[];
  /** PAYOUT: only shifts this caregiver worked. */
  caregiverId?: string;
  bookings: LineBooking[];
  shifts: LineShift[];
  billedShiftIds: ReadonlySet<string>;
  billedPeriods: readonly BilledPeriod[];
}

export interface BuildResult {
  lines: BuiltLine[];
  /** Shifts or monthly periods left out because they are already billed. */
  skipped: number;
  /** Lines priced at zero because neither the booking nor the shift has a rate. */
  unpriced: number;
}

const TEXT: Record<CareRequestLanguage, { shift: string; month: string }> = {
  en: { shift: 'Care shift {start}–{end} ({ref})', month: 'Monthly care, {from} to {to} ({ref})' },
  si: { shift: 'රැකවරණ වාරය {start}–{end} ({ref})', month: 'මාසික රැකවරණය, {from} සිට {to} දක්වා ({ref})' },
  ta: { shift: 'பராமரிப்புப் பணிநேரம் {start}–{end} ({ref})', month: 'மாதாந்திரப் பராமரிப்பு, {from} முதல் {to} வரை ({ref})' },
};
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

/** Months in [from, to]: each whole calendar month = 1, each part-month = its days / 30. Two places. */
export function monthsIn(from: string, to: string): string {
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    const monthStart = `${cursor.slice(0, 7)}-01`;
    const [y, m] = cursor.slice(0, 7).split('-').map(Number);
    const monthEnd = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
    const segEnd = to < monthEnd ? to : monthEnd;
    total += cursor === monthStart && segEnd === monthEnd ? 1 : daysInclusive(cursor, segEnd) / 30;
    cursor = addDays(segEnd, 1);
  }
  return (Math.round(total * 100) / 100).toFixed(2);
}

const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string) => aFrom <= bTo && bFrom <= aTo;

export function buildLines(input: BuildInput): BuildResult {
  const bookingsById = new Map(input.bookings.map((b) => [b.id, b]));
  const wanted = input.shifts
    .filter((s) => input.statuses.includes(s.status))
    .filter((s) => !input.caregiverId || s.caregiverId === input.caregiverId)
    .map((s) => ({ ...s, day: toColombo(s.startsAt).date }))
    .filter((s) => s.day >= input.from && s.day <= input.to && bookingsById.has(s.bookingId))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const lines: BuiltLine[] = [];
  let skipped = 0;
  let unpriced = 0;
  const t = TEXT[input.language] ?? TEXT.en;
  const monthlyDone = new Set<string>();

  for (const s of wanted) {
    const b = bookingsById.get(s.bookingId)!;
    const rate = b.rateType && b.rateAmount ? b.rateAmount : null;
    const isMonthly = b.rateType === 'MONTHLY';
    // On a payout, the booked caregiver of a monthly booking is paid by the
    // month; anyone covering one of its shifts is paid by the shift.
    const monthlyLine = isMonthly && (input.mode === 'INVOICE' || s.caregiverId === b.caregiverId);

    if (monthlyLine) {
      if (monthlyDone.has(b.id)) continue;
      monthlyDone.add(b.id);
      const from = input.from > b.startDate ? input.from : b.startDate;
      const to = input.to < b.endDate ? input.to : b.endDate;
      if (input.billedPeriods.some((p) => p.bookingId === b.id && overlaps(p.periodStart, p.periodEnd, from, to))) {
        skipped++;
        continue;
      }
      lines.push({
        kind: 'SHIFT',
        description: input.mode === 'INVOICE' ? fill(t.month, { from, to, ref: b.reference }) : `${b.reference} · ${from} – ${to}`,
        serviceDate: null,
        quantity: monthsIn(from, to),
        unit: 'MONTH',
        unitPrice: rate ?? '0.00',
        shiftId: null,
        bookingId: b.id,
        caregiverId: b.caregiverId,
        periodStart: from,
        periodEnd: to,
      });
      if (!rate) unpriced++;
      continue;
    }

    if (input.billedShiftIds.has(s.id)) {
      skipped++;
      continue;
    }
    const start = toColombo(s.startsAt).time;
    const end = toColombo(s.endsAt).time;
    const own = s.rateType && s.rateAmount ? { type: s.rateType, amount: s.rateAmount } : null;
    let quantity = '1.00';
    let unit: BillingUnit = 'DAY';
    let unitPrice = own?.amount ?? rate ?? '0.00';
    if (own) {
      if (own.type === 'HOURLY') {
        quantity = shiftHours(s.startsAt, s.endsAt).toFixed(2);
        unit = 'HOUR';
      }
    } else if (b.rateType === 'HOURLY' || !b.rateType) {
      quantity = shiftHours(s.startsAt, s.endsAt).toFixed(2);
      unit = 'HOUR';
    } else if (isMonthly) {
      // A cover shift on a monthly booking: a thirtieth of the month.
      unitPrice = rate ? fromCents(roundHalfAway(toCents(rate) / 30)) : '0.00';
    }
    lines.push({
      kind: 'SHIFT',
      description: input.mode === 'INVOICE' ? fill(t.shift, { start, end, ref: b.reference }) : `${b.reference} · ${start}–${end}`,
      serviceDate: s.day,
      quantity,
      unit,
      unitPrice,
      shiftId: s.id,
      bookingId: b.id,
      caregiverId: s.caregiverId,
      periodStart: null,
      periodEnd: null,
    });
    if (!own && !rate) unpriced++;
  }
  return { lines, skipped, unpriced };
}
