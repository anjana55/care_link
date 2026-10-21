import {
  computeTotals,
  formatLkr,
  fromCents,
  shiftHours,
  toCents,
  toColombo,
  type AmendmentDocumentAction,
  type AmendmentDocumentImpact,
  type AmendmentShiftChange,
  type BillingUnit,
  type DiscountType,
  type InvoiceBasis,
  type RateType,
  type ShiftStatus,
} from '@care-platform/shared';
import { buildLines, type BuiltLine, type LineBooking, type LineShift } from '../billing/line-builder';
import type { CareRequestLanguage } from '../database/schema';

/**
 * What a booking correction does to the money - worked out without a
 * database, so the rules can be read and tested in one place.
 *
 * Given the booking and its shifts before and after the correction, and every
 * live (not void) invoice and pay statement that bills them, it works out for
 * each document which of its lines the correction touches, what those lines
 * come to now, and how the document takes the difference:
 *
 * - A DRAFT invoice or statement is rebuilt in place (REFRESH).
 * - An ISSUED invoice with nothing paid is, by default, voided and replaced
 *   by a corrected draft copy (REPLACE); staff may carry the difference
 *   instead (CARRY).
 * - An invoice with money paid against it, and a PAID statement, never
 *   change: the difference becomes a billing adjustment, carried onto the
 *   next invoice to that client or the next statement for that caregiver.
 * - An APPROVED statement (not paid yet) goes back to draft and is rebuilt
 *   (REOPEN).
 *
 * Lines are rebuilt with the same line builder that made them, so a
 * corrected line is priced exactly as a fresh one would be. A line's own
 * discount is kept; anything else staff typed over (a hand-set price) is
 * replaced, and the preview shows each line before and after so they can
 * see it.
 *
 * One more case: a shift moved to another caregiver when the original
 * caregiver's statement is already paid. The shift stays "paid" on that
 * statement (that is what keeps it off every other one), so the new
 * caregiver cannot get it through a statement in the usual way - they get a
 * caregiver adjustment for it instead.
 */

export interface PlanBooking {
  id: string;
  reference: string;
  patientId: string;
  caregiverId: string;
  startDate: string;
  endDate: string;
  rateType: RateType | null;
  rateAmount: string | null;
  payRateType: RateType | null;
  payRateAmount: string | null;
}

export interface PlanShift {
  id: string;
  bookingId: string;
  caregiverId: string;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  rateType: 'HOURLY' | 'DAILY' | null;
  rateAmount: string | null;
  payRateType: 'HOURLY' | 'DAILY' | null;
  payRateAmount: string | null;
  note?: string | null;
}

export interface PlanLine {
  id: string;
  position: number;
  kind: 'SHIFT' | 'ITEM' | 'ADJUSTMENT';
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discountType: DiscountType | null;
  discountValue: string | null;
  amount: string;
  shiftId: string | null;
  bookingId: string | null;
  caregiverId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Invoice lines: whether tax applies to it. */
  taxable?: boolean;
}

export interface PlanDocument {
  kind: 'INVOICE' | 'PAYOUT';
  id: string;
  label: string | null;
  status: string;
  /** INVOICE: what it bills (decides which shift statuses count). */
  basis?: InvoiceBasis;
  /** PAYOUT: whose statement it is. */
  caregiverId?: string;
  language: CareRequestLanguage;
  amountPaid?: string;
  /** INVOICE: the discount on the whole invoice, and the tax rate (null = untaxed). */
  discountType?: DiscountType | null;
  discountValue?: string | null;
  taxRate?: string | null;
  partyName: string | null;
  lines: PlanLine[];
}

export interface PlanInput {
  before: { booking: PlanBooking; shifts: PlanShift[] };
  after: { booking: PlanBooking; shifts: PlanShift[] };
  /** Every shift the correction names - changed, added, or just listed to re-price. */
  touched: ReadonlySet<string>;
  documents: PlanDocument[];
  caregiverNames: ReadonlyMap<string, string>;
  clientName: string | null;
  invoiceChoices?: Record<string, 'REPLACE' | 'CARRY'>;
}

/** A rebuilt line: the stored line's new values, or null when it goes. */
export type RebuiltLine = Pick<PlanLine, 'description' | 'serviceDate' | 'quantity' | 'unit' | 'unitPrice' | 'amount' | 'caregiverId'> | null;

export interface PlannedDocument extends AmendmentDocumentImpact {
  /** line id -> its new values (null: remove it). Only lines the correction touches. */
  rebuilt: Map<string, RebuiltLine>;
}

export interface PlannedAdjustment {
  side: 'CLIENT' | 'CAREGIVER';
  patientId: string | null;
  caregiverId: string | null;
  partyName: string | null;
  amount: string;
  /** CLIENT: carried onto the next invoice as a taxable line (the original invoice was taxed). */
  taxable: boolean;
  description: string;
  sourceLabel: string | null;
}

export interface AmendmentPlan {
  documents: PlannedDocument[];
  adjustments: PlannedAdjustment[];
  unbilled: { client: string[]; pay: string[] };
  warnings: string[];
}

const INVOICE_STATUSES: Record<InvoiceBasis, ShiftStatus[]> = {
  COMPLETED: ['COMPLETED'],
  SCHEDULED: ['SCHEDULED', 'COMPLETED'],
  MANUAL: ['COMPLETED'],
};
const PAYOUT_STATUSES: ShiftStatus[] = ['COMPLETED'];

const day = (d: Date) => toColombo(d).date;

/** The booking as one side of the money sees it: the client's rate, or the caregiver's pay rate. */
function sideBooking(b: PlanBooking, kind: PlanDocument['kind']): LineBooking {
  return {
    id: b.id,
    reference: b.reference,
    caregiverId: b.caregiverId,
    startDate: b.startDate,
    endDate: b.endDate,
    rateType: kind === 'INVOICE' ? b.rateType : b.payRateType,
    rateAmount: kind === 'INVOICE' ? b.rateAmount : b.payRateAmount,
  };
}
function sideShift(s: PlanShift, kind: PlanDocument['kind']): LineShift {
  return {
    id: s.id,
    bookingId: s.bookingId,
    caregiverId: s.caregiverId,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    status: s.status,
    rateType: kind === 'INVOICE' ? s.rateType : s.payRateType,
    rateAmount: kind === 'INVOICE' ? s.rateAmount : s.payRateAmount,
  };
}

function statusesFor(doc: PlanDocument): ShiftStatus[] {
  return doc.kind === 'INVOICE' ? INVOICE_STATUSES[doc.basis ?? 'COMPLETED'] : PAYOUT_STATUSES;
}

/** The line a fresh build would make for this one, in the corrected state. */
function rebuild(doc: PlanDocument, line: PlanLine, after: PlanInput['after']): BuiltLine | null {
  const booking = sideBooking(after.booking, doc.kind);
  const common = {
    mode: doc.kind === 'INVOICE' ? ('INVOICE' as const) : ('PAYOUT' as const),
    language: doc.kind === 'INVOICE' ? doc.language : ('en' as const),
    statuses: statusesFor(doc),
    caregiverId: doc.kind === 'PAYOUT' ? doc.caregiverId : undefined,
    bookings: [booking],
    billedShiftIds: new Set<string>(),
    billedPeriods: [],
  };
  if (line.shiftId) {
    const s = after.shifts.find((x) => x.id === line.shiftId);
    if (!s) return null;
    // Built on the shift's own (new) day, so a shift moved across midnight
    // stays on the document that bills it.
    const d = day(s.startsAt);
    const { lines } = buildLines({ ...common, from: d, to: d, shifts: [sideShift(s, doc.kind)] });
    return lines.find((l) => l.shiftId === s.id) ?? null;
  }
  if (line.periodStart && line.periodEnd) {
    const shifts = after.shifts
      .filter((s) => s.bookingId === booking.id)
      .map((s) => sideShift(s, doc.kind))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const { lines } = buildLines({ ...common, from: line.periodStart, to: line.periodEnd, shifts });
    return lines.find((l) => !l.shiftId && l.bookingId === booking.id) ?? null;
  }
  return null;
}

/** Whether the correction can change this line at all. */
function touches(doc: PlanDocument, line: PlanLine, input: PlanInput, rateChanged: { INVOICE: boolean; PAYOUT: boolean }, touchedDays: string[]) {
  if (line.kind !== 'SHIFT' || line.bookingId !== input.after.booking.id) return false;
  if (rateChanged[doc.kind]) return true;
  if (line.shiftId) return input.touched.has(line.shiftId);
  if (line.periodStart && line.periodEnd) return touchedDays.some((d) => d >= line.periodStart! && d <= line.periodEnd!);
  return false;
}

const lineAmount = (built: BuiltLine, old: PlanLine) =>
  computeTotals({ lines: [{ quantity: built.quantity, unitPrice: built.unitPrice, discountType: old.discountType, discountValue: old.discountValue }] }).lines[0].amount;

const sameLine = (old: PlanLine, next: RebuiltLine) =>
  next !== null &&
  old.quantity === next.quantity &&
  old.unitPrice === next.unitPrice &&
  old.unit === next.unit &&
  old.description === next.description &&
  old.serviceDate === next.serviceDate &&
  old.amount === next.amount &&
  old.caregiverId === next.caregiverId;

function actionFor(doc: PlanDocument, difference: number, choice?: 'REPLACE' | 'CARRY'): { action: AmendmentDocumentAction; choices: AmendmentDocumentAction[] } {
  if (doc.status === 'DRAFT') return { action: 'REFRESH', choices: ['REFRESH'] };
  // A document the client or caregiver has seen changes only for money,
  // never just to re-word a line.
  if (difference === 0) return { action: 'NONE', choices: ['NONE'] };
  if (doc.kind === 'INVOICE') {
    if (doc.status === 'ISSUED' && toCents(doc.amountPaid ?? '0') === 0) {
      return { action: choice ?? 'REPLACE', choices: ['REPLACE', 'CARRY'] };
    }
    return { action: 'CARRY', choices: ['CARRY'] };
  }
  if (doc.status === 'APPROVED') return { action: 'REOPEN', choices: ['REOPEN'] };
  return { action: 'CARRY', choices: ['CARRY'] };
}

/** "BK-7Q2M4X · 12 Oct, 14 Oct" - what an adjustment line says it is for. */
function adjustmentText(reference: string, dates: string[]) {
  const unique = [...new Set(dates.filter(Boolean))].sort();
  if (!unique.length) return reference;
  const shown = unique.slice(0, 6).map((d) => {
    const [, m, dd] = d.split('-');
    return `${Number(dd)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]}`;
  });
  return `${reference} · ${shown.join(', ')}${unique.length > 6 ? ` +${unique.length - 6}` : ''}`;
}

/**
 * What a whole document comes to with some of its lines replaced: for an
 * invoice its total, and what it comes to after its own discount but before
 * tax (which is what a carried difference is - the next invoice adds its own
 * tax); for a statement simply its total.
 */
function documentTotals(doc: PlanDocument, rebuilt?: ReadonlyMap<string, RebuiltLine>) {
  const lines = doc.lines.flatMap((l) => {
    if (!rebuilt?.has(l.id)) return [l];
    const next = rebuilt.get(l.id);
    return next ? [{ ...l, ...next }] : [];
  });
  if (doc.kind === 'PAYOUT') {
    const t = computeTotals({ lines: lines.map((l) => ({ ...l, taxable: false })) });
    return { total: toCents(t.total), beforeTax: toCents(t.total) };
  }
  const t = computeTotals({ lines, discountType: doc.discountType, discountValue: doc.discountValue, taxRate: doc.taxRate });
  return { total: toCents(t.total), beforeTax: toCents(t.subtotal) - toCents(t.discount) };
}

export function planAmendment(input: PlanInput): AmendmentPlan {
  const { before, after } = input;
  const rateChanged = {
    INVOICE: before.booking.rateAmount !== after.booking.rateAmount,
    PAYOUT: before.booking.payRateAmount !== after.booking.payRateAmount,
  };
  const touchedDays = [...input.touched].flatMap((id) =>
    [before.shifts.find((s) => s.id === id), after.shifts.find((s) => s.id === id)].filter((s): s is PlanShift => Boolean(s)).map((s) => day(s.startsAt)),
  );

  const documents: PlannedDocument[] = [];
  const adjustments: PlannedAdjustment[] = [];
  const warnings: string[] = [];
  // Shifts each kind of document will still bill once the plan is applied.
  const stillOn = { INVOICE: new Set<string>(), PAYOUT: new Set<string>() };
  // Shifts moved off a paid statement: the new caregiver is owed them directly.
  const lockedPayout = new Map<string, PlanDocument>();

  for (const doc of input.documents) {
    for (const line of doc.lines) if (line.shiftId) stillOn[doc.kind].add(line.shiftId);
    // Every touched line whose rebuilt version differs - in money, or only in
    // its words (a daily-rate shift with new times).
    const found: { line: PlanLine; next: RebuiltLine; money: boolean }[] = [];
    for (const line of doc.lines) {
      if (!touches(doc, line, input, rateChanged, touchedDays)) continue;
      const built = rebuild(doc, line, after);
      const next: RebuiltLine = built
        ? {
            description: built.description,
            serviceDate: built.serviceDate,
            quantity: built.quantity,
            unit: built.unit,
            unitPrice: built.unitPrice,
            amount: lineAmount(built, line),
            caregiverId: built.caregiverId,
          }
        : null;
      if (sameLine(line, next)) continue;
      found.push({ line, next, money: next === null || next.amount !== line.amount });
    }
    if (!found.length) continue;

    const lineDifference = found.reduce((sum, f) => sum + (f.next ? toCents(f.next.amount) : 0) - toCents(f.line.amount), 0);
    const { action, choices } = actionFor(doc, lineDifference, doc.kind === 'INVOICE' ? input.invoiceChoices?.[doc.id] : undefined);
    // A document that stays as it is only cares about the money; one that is
    // rewritten (a draft, a replacement copy) takes the new wording too.
    const kept = action === 'CARRY' || action === 'NONE' ? found.filter((f) => f.money) : found;
    if (!kept.length) continue;

    const rebuilt = new Map<string, RebuiltLine>();
    const lines: AmendmentDocumentImpact['lines'] = [];
    const dates: string[] = [];
    for (const { line, next } of kept) {
      rebuilt.set(line.id, next);
      if (next === null && line.shiftId) stillOn[doc.kind].delete(line.shiftId);
      if (doc.kind === 'PAYOUT' && doc.status === 'PAID' && line.shiftId && next === null) lockedPayout.set(line.shiftId, doc);
      if (next === null || next.amount !== line.amount) dates.push(line.serviceDate ?? line.periodStart ?? '');
      lines.push({ lineId: line.id, description: line.description, serviceDate: line.serviceDate, before: line.amount, after: next ? next.amount : null });
    }

    // The whole document before and after, with its own discount and tax.
    const was = documentTotals(doc);
    const now = documentTotals(doc, rebuilt);
    documents.push({
      kind: doc.kind,
      id: doc.id,
      label: doc.label,
      status: doc.status,
      partyName: doc.partyName,
      before: fromCents(was.total),
      after: fromCents(now.total),
      difference: fromCents(now.total - was.total),
      action,
      choices,
      lines,
      rebuilt,
    });

    if (action === 'CARRY' || action === 'NONE') {
      // Lines on a document that will not change keep billing their shifts.
      for (const id of rebuilt.keys()) {
        const l = doc.lines.find((x) => x.id === id);
        if (l?.shiftId) stillOn[doc.kind].add(l.shiftId);
      }
    }
    if (action === 'CARRY') {
      adjustments.push({
        side: doc.kind === 'INVOICE' ? 'CLIENT' : 'CAREGIVER',
        patientId: doc.kind === 'INVOICE' ? after.booking.patientId : null,
        caregiverId: doc.kind === 'PAYOUT' ? (doc.caregiverId ?? null) : null,
        partyName: doc.partyName,
        // After the document's own discount, before tax.
        amount: fromCents(now.beforeTax - was.beforeTax),
        taxable: doc.kind === 'INVOICE' && Boolean(doc.taxRate && toCents(doc.taxRate) > 0),
        description: adjustmentText(after.booking.reference, dates),
        sourceLabel: doc.label,
      });
      if (doc.kind === 'INVOICE' && doc.taxRate && toCents(doc.taxRate) > 0) {
        warnings.push(`${doc.label ?? 'The invoice'} was taxed: the carried amount is before tax, and the next invoice adds tax on it at its own rate.`);
      }
    }
  }

  // The new caregiver of a shift taken off a paid statement.
  for (const [shiftId, doc] of lockedPayout) {
    const s = after.shifts.find((x) => x.id === shiftId);
    if (!s || s.status !== 'COMPLETED' || s.caregiverId === doc.caregiverId) continue;
    const pay = rebuild({ ...doc, caregiverId: s.caregiverId, status: 'DRAFT' }, { ...doc.lines.find((l) => l.shiftId === shiftId)!, discountType: null, discountValue: null }, after);
    if (!pay) continue;
    const amount = computeTotals({ lines: [{ quantity: pay.quantity, unitPrice: pay.unitPrice }] }).lines[0].amount;
    if (toCents(amount) === 0) continue;
    adjustments.push({
      side: 'CAREGIVER',
      patientId: null,
      caregiverId: s.caregiverId,
      partyName: input.caregiverNames.get(s.caregiverId) ?? null,
      amount,
      taxable: false,
      description: adjustmentText(after.booking.reference, [day(s.startsAt)]),
      sourceLabel: doc.label,
    });
    stillOn.PAYOUT.add(s.id);
  }

  // Touched shifts that should be billed or paid but are on nothing.
  const unbilled = { client: [] as string[], pay: [] as string[] };
  const b = after.booking;
  for (const id of input.touched) {
    const s = after.shifts.find((x) => x.id === id);
    if (!s || s.status !== 'COMPLETED') continue;
    const label = `${day(s.startsAt)} ${toColombo(s.startsAt).time}`;
    if (b.rateType !== 'MONTHLY' && !stillOn.INVOICE.has(s.id)) unbilled.client.push(label);
    const monthlyPay = b.payRateType === 'MONTHLY' && s.caregiverId === b.caregiverId;
    if (!monthlyPay && !stillOn.PAYOUT.has(s.id)) unbilled.pay.push(`${label} · ${input.caregiverNames.get(s.caregiverId) ?? ''}`.trim());
  }

  for (const a of adjustments) {
    if (a.side === 'CLIENT' && toCents(a.amount) < 0) {
      warnings.push(`${formatLkr(a.amount.replace('-', ''))} is owed back to ${a.partyName ?? 'the client'}. It comes off their next invoice (any part bigger than that invoice waits for the one after) - or settle it as a refund from the booking.`);
    }
  }
  return { documents, adjustments, unbilled, warnings };
}

// --- describing the change ------------------------------------------------------

const RATE_UNIT = { HOURLY: 'per hour', DAILY: 'per shift', MONTHLY: 'per month' } as const;
const rateText = (type: string | null, amount: string | null) => (type && amount ? `${formatLkr(amount)} ${RATE_UNIT[type as keyof typeof RATE_UNIT]}` : 'booking rate');
const hm = (d: Date) => toColombo(d).time;

/** What changed on each shift, in words, for the preview and the booking's history (English, like every history note). */
export function describeChanges(
  before: { booking: PlanBooking; shifts: PlanShift[] },
  after: { booking: PlanBooking; shifts: PlanShift[] },
  touched: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): AmendmentShiftChange[] {
  const out: AmendmentShiftChange[] = [];
  const bookingChanges: string[] = [];
  if (before.booking.rateAmount !== after.booking.rateAmount) {
    bookingChanges.push(`client rate ${rateText(before.booking.rateType, before.booking.rateAmount)} → ${rateText(after.booking.rateType, after.booking.rateAmount)}`);
  }
  if (before.booking.payRateAmount !== after.booking.payRateAmount) {
    bookingChanges.push(`pay rate ${rateText(before.booking.payRateType, before.booking.payRateAmount)} → ${rateText(after.booking.payRateType, after.booking.payRateAmount)}`);
  }
  if (bookingChanges.length) out.push({ shiftId: null, date: '', changes: bookingChanges });

  const name = (id: string) => names.get(id) ?? 'another caregiver';
  for (const s of after.shifts.filter((x) => touched.has(x.id)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const old = before.shifts.find((x) => x.id === s.id);
    const changes: string[] = [];
    if (!old) {
      changes.push(`added: ${hm(s.startsAt)}–${hm(s.endsAt)} (${shiftHours(s.startsAt, s.endsAt)} h), worked by ${name(s.caregiverId)}`);
    } else {
      if (old.startsAt.getTime() !== s.startsAt.getTime() || old.endsAt.getTime() !== s.endsAt.getTime()) {
        const oldDay = day(old.startsAt) !== day(s.startsAt) ? `${day(old.startsAt)} ` : '';
        changes.push(`times ${oldDay}${hm(old.startsAt)}–${hm(old.endsAt)} → ${hm(s.startsAt)}–${hm(s.endsAt)} (${shiftHours(s.startsAt, s.endsAt)} h)`);
      }
      if (old.status !== s.status) changes.push(`${old.status} → ${s.status}`);
      if (old.caregiverId !== s.caregiverId) changes.push(`worked by ${name(s.caregiverId)} (was ${name(old.caregiverId)})`);
      if (old.rateType !== s.rateType || old.rateAmount !== s.rateAmount) changes.push(`client rate ${rateText(old.rateType, old.rateAmount)} → ${rateText(s.rateType, s.rateAmount)}`);
      if (old.payRateType !== s.payRateType || old.payRateAmount !== s.payRateAmount) changes.push(`pay rate ${rateText(old.payRateType, old.payRateAmount)} → ${rateText(s.payRateType, s.payRateAmount)}`);
      if ((old.note ?? null) !== (s.note ?? null)) changes.push(s.note ? `note: ${s.note}` : 'note removed');
      if (!changes.length) changes.push('re-checked against billing, no change');
    }
    out.push({ shiftId: s.id, date: day(s.startsAt), changes });
  }
  return out;
}
