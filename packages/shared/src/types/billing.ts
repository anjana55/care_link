/**
 * Invoicing and caregiver payouts, shared by the API and both web apps.
 *
 * Money: every amount travels as a decimal string with two places ("3500.00"),
 * the way MySQL DECIMAL columns come back, and every sum is worked in whole
 * cents (integers), never in floating-point rupees. The totals function below
 * is the single place an invoice or payout total is calculated: the API stores
 * what it returns, and the staff editor calls the same function to preview a
 * draft as it is typed, so the two can never disagree by a cent.
 *
 * Rounding is half away from zero, to the cent, at three points only: each
 * line (quantity x price, then its discount), the invoice discount, and tax.
 */

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
/** Where a new invoice's lines come from. MANUAL starts empty. */
export type InvoiceBasis = 'COMPLETED' | 'SCHEDULED' | 'MANUAL';
/**
 * SHIFT       generated from one shift (or, for a monthly rate, a period of a booking).
 * ITEM        any other charge staff add: registration fee, transport, supplies.
 * ADJUSTMENT  a correction, usually a credit (negative price): a missed shift billed in advance, a late start.
 */
export type BillingLineKind = 'SHIFT' | 'ITEM' | 'ADJUSTMENT';
export type BillingUnit = 'HOUR' | 'DAY' | 'MONTH' | 'ITEM';
export type DiscountType = 'PERCENT' | 'AMOUNT';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'PAYHERE' | 'OTHER';
export type PayoutStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'VOID';

export const INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'ISSUED', 'PAID', 'VOID'];
export const PAYOUT_STATUSES: PayoutStatus[] = ['DRAFT', 'APPROVED', 'PAID', 'VOID'];
export const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'PAYHERE', 'OTHER'];
/** Methods staff can record by hand; PAYHERE payments only ever arrive from PayHere itself. */
export const MANUAL_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'];
export const BILLING_UNITS: BillingUnit[] = ['HOUR', 'DAY', 'MONTH', 'ITEM'];

/** The most lines one invoice or payout may carry - a year of daily shifts plus room for extras. */
export const MAX_BILLING_LINES = 500;

// --- cents ------------------------------------------------------------------

const DECIMAL = /^-?\d{1,10}(\.\d{1,2})?$/;

export const isMoney = (v: string) => DECIMAL.test(v.trim());

/** "1234.5" -> 123450. Throws on anything that is not a plain decimal with at most two places. */
export function toCents(v: string | number): number {
  const s = typeof v === 'number' ? v.toFixed(2) : v.trim();
  if (!DECIMAL.test(s)) throw new Error(`Not an amount: ${v}`);
  const negative = s.startsWith('-');
  const [whole, frac = ''] = (negative ? s.slice(1) : s).split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** 123450 -> "1234.50"; -5 -> "-0.05". */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Half away from zero, so a credit rounds the same way as a charge. */
export const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);

/** "LKR 12,345.00" for display. Locale-independent digits: invoices are read alongside bank slips. */
export function formatLkr(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const cents = typeof amount === 'number' ? Math.round(amount * 100) : toCents(amount);
  const s = fromCents(Math.abs(cents));
  const [whole, frac] = s.split('.');
  return `${cents < 0 ? '-' : ''}LKR ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

// --- totals -----------------------------------------------------------------

export interface TotalsLineInput {
  quantity: string;
  unitPrice: string;
  discountType?: DiscountType | null;
  discountValue?: string | null;
  /** Payout lines are never taxed; leave undefined there. */
  taxable?: boolean;
}

export interface TotalsInput {
  lines: TotalsLineInput[];
  discountType?: DiscountType | null;
  discountValue?: string | null;
  /** Percentage, e.g. "18.00". Null or undefined = no tax. */
  taxRate?: string | null;
}

export interface LineTotals {
  /** quantity x unit price */
  gross: string;
  /** what the line's own discount takes off (never more than the line) */
  discount: string;
  /** gross - discount: what the line contributes to the subtotal */
  amount: string;
}

export interface Totals {
  lines: LineTotals[];
  subtotal: string;
  /** the invoice-level discount */
  discount: string;
  /** the part of (subtotal - discount) that tax is charged on */
  taxableAmount: string;
  tax: string;
  total: string;
}

function discountCents(baseCents: number, type: DiscountType | null | undefined, value: string | null | undefined): number {
  if (!type || !value || baseCents <= 0) return 0;
  const v = toCents(value);
  if (v <= 0) return 0;
  if (type === 'PERCENT') return Math.min(baseCents, roundHalfAway((baseCents * Math.min(v, 10000)) / 10000));
  return Math.min(baseCents, v);
}

/**
 * Lines, then the invoice discount (spread over taxable and untaxed lines in
 * proportion), then tax on what is left of the taxable part. A discount never
 * takes a line or the subtotal below zero; a negative line (a credit) is
 * never discounted.
 */
export function computeTotals(input: TotalsInput): Totals {
  const lines = input.lines.map((l) => {
    const gross = roundHalfAway((toCents(l.quantity) * toCents(l.unitPrice)) / 100);
    const discount = discountCents(gross, l.discountType, l.discountValue);
    return { gross, discount, amount: gross - discount, taxable: l.taxable !== false };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const discount = discountCents(subtotal, input.discountType, input.discountValue);
  const taxableSubtotal = lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0);
  const rate = input.taxRate ? toCents(input.taxRate) : 0;
  let taxableAmount = 0;
  let tax = 0;
  if (rate > 0) {
    const share = subtotal > 0 ? roundHalfAway((discount * taxableSubtotal) / subtotal) : 0;
    taxableAmount = Math.max(0, taxableSubtotal - share);
    tax = roundHalfAway((taxableAmount * rate) / 10000);
  }
  return {
    lines: lines.map((l) => ({ gross: fromCents(l.gross), discount: fromCents(l.discount), amount: fromCents(l.amount) })),
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    taxableAmount: fromCents(taxableAmount),
    tax: fromCents(tax),
    total: fromCents(subtotal - discount + tax),
  };
}

/** Calendar days from one 'YYYY-MM-DD' to another, both included. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

// --- what clients and caregivers see ---------------------------------------------

export interface PortalBillingLine {
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discount: string;
  amount: string;
}

export interface BillingParty {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Business registration number. */
  registrationNumber: string | null;
  /** VAT or other tax registration, shown only when tax is charged. */
  taxRegistrationNumber: string | null;
}

/** GET /me/invoices and /me/invoices/:id (client). Issued, paid and void only - never a draft. */
export interface ClientInvoice {
  id: string;
  number: string;
  status: Exclude<InvoiceStatus, 'DRAFT'>;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  bookingReference: string | null;
  seller: BillingParty;
  billTo: { name: string; address: string | null; phone: string | null; email: string | null };
  lines: PortalBillingLine[];
  subtotal: string;
  discount: string;
  discountLabel: string | null;
  taxName: string | null;
  taxRate: string | null;
  tax: string;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  notes: string | null;
  footer: string | null;
  payments: { paidOn: string; amount: string; method: PaymentMethod; reference: string | null }[];
  /** True when the client can pay the balance online right now. */
  canPayOnline: boolean;
}

/** POST /me/invoices/:id/payhere - the form the browser posts to PayHere. */
export interface PayhereCheckout {
  action: string;
  fields: Record<string, string>;
}

/** GET /me/payouts (caregiver). Approved and paid statements only. */
export interface CaregiverPayout {
  id: string;
  reference: string;
  status: Extract<PayoutStatus, 'APPROVED' | 'PAID'>;
  periodStart: string;
  periodEnd: string;
  lines: PortalBillingLine[];
  total: string;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
}
