import { mysqlTable, varchar, datetime, date, mysqlEnum, text, index, decimal, boolean, int, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { careRequestLanguageEnum } from './care-requests.schema';

/**
 * Billing: invoices to clients, payout statements to caregivers, and the money
 * that moves against them. Every amount is DECIMAL(12,2) and every sum is
 * worked in cents by computeTotals (packages/shared billing.ts); the totals
 * stored here are what that function returned when the document last changed.
 */

export const invoiceStatusEnum = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export const invoiceBasisEnum = ['COMPLETED', 'SCHEDULED', 'MANUAL'] as const;
export const billingLineKindEnum = ['SHIFT', 'ITEM', 'ADJUSTMENT'] as const;
export const billingUnitEnum = ['HOUR', 'DAY', 'MONTH', 'ITEM'] as const;
export const discountTypeEnum = ['PERCENT', 'AMOUNT'] as const;
export const paymentMethodEnum = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'PAYHERE', 'OTHER'] as const;
export const payoutStatusEnum = ['DRAFT', 'APPROVED', 'PAID', 'VOID'] as const;
export const payhereModeEnum = ['SANDBOX', 'LIVE'] as const;

export type InvoiceStatusDb = (typeof invoiceStatusEnum)[number];
export type PayoutStatusDb = (typeof payoutStatusEnum)[number];
export type PaymentMethodDb = (typeof paymentMethodEnum)[number];

/**
 * Admin-managed billing settings - a single row, id 'default', like the email
 * and WhatsApp settings: who the invoices are from, tax, numbering, and the
 * PayHere merchant. The merchant secret is encrypted at rest and never
 * returned by the API.
 */
export const billingSettings = mysqlTable('billing_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  businessName: varchar('business_name', { length: 200 }).notNull().default('CareLink'),
  businessAddress: varchar('business_address', { length: 500 }),
  businessPhone: varchar('business_phone', { length: 40 }),
  businessEmail: varchar('business_email', { length: 255 }),
  registrationNumber: varchar('registration_number', { length: 60 }),

  // Off by default: most small agencies are below the VAT threshold.
  taxEnabled: boolean('tax_enabled').notNull().default(false),
  taxName: varchar('tax_name', { length: 40 }).notNull().default('VAT'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
  taxRegistrationNumber: varchar('tax_registration_number', { length: 60 }),

  invoicePrefix: varchar('invoice_prefix', { length: 12 }).notNull().default('INV'),
  // The next number an issued invoice takes. Issued invoices are numbered
  // without gaps, in issue order; a draft has no number.
  nextInvoiceNumber: int('next_invoice_number').notNull().default(1),
  paymentTermsDays: int('payment_terms_days').notNull().default(7),
  // Printed at the foot of every invoice: bank details, thank-you line.
  invoiceFooter: text('invoice_footer'),

  payhereEnabled: boolean('payhere_enabled').notNull().default(false),
  payhereMode: mysqlEnum('payhere_mode', payhereModeEnum).notNull().default('SANDBOX'),
  payhereMerchantId: varchar('payhere_merchant_id', { length: 40 }),
  payhereMerchantSecretEncrypted: text('payhere_merchant_secret_encrypted'),
  // Where PayHere posts payment notifications: the API's public address, e.g.
  // https://find.caregivers.lk/api. Empty = PUBLIC_WEB_URL + /api.
  payhereNotifyBaseUrl: varchar('payhere_notify_base_url', { length: 255 }),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * An invoice to a client.
 *
 * - DRAFT   staff are still shaping it: lines, prices, discounts, all editable.
 *           No number yet; the client cannot see it.
 * - ISSUED  numbered, locked and sent. Payments are recorded against it.
 * - PAID    payments cover the total. Drops back to ISSUED if a payment is
 *           refunded or charged back.
 * - VOID    cancelled after issue (only with nothing paid). The number stays
 *           used, so the sequence has no holes; a corrected copy is a new draft.
 */
export const invoices = mysqlTable(
  'invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    number: varchar('number', { length: 24 }).unique(),
    patientId: varchar('patient_id', { length: 36 }).notNull(),
    // The booking it bills, when it bills one. A MANUAL invoice may have none.
    bookingId: varchar('booking_id', { length: 36 }),
    status: mysqlEnum('status', invoiceStatusEnum).notNull().default('DRAFT'),
    basis: mysqlEnum('basis', invoiceBasisEnum).notNull(),
    periodStart: date('period_start', { mode: 'string' }),
    periodEnd: date('period_end', { mode: 'string' }),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    language: mysqlEnum('language', careRequestLanguageEnum).notNull().default('en'),

    // Who it is addressed to - filled from the client when the draft is made,
    // editable while it is a draft, and frozen on issue.
    billToName: varchar('bill_to_name', { length: 200 }).notNull(),
    billToAddress: varchar('bill_to_address', { length: 500 }),
    billToPhone: varchar('bill_to_phone', { length: 40 }),
    billToEmail: varchar('bill_to_email', { length: 255 }),
    // Who it is from: a JSON copy of the business details taken on issue, so a
    // later change of address or tax number never rewrites an old invoice.
    sellerSnapshot: text('seller_snapshot'),
    footer: text('footer'),

    discountType: mysqlEnum('discount_type', discountTypeEnum),
    discountValue: decimal('discount_value', { precision: 12, scale: 2 }),
    discountReason: varchar('discount_reason', { length: 200 }),
    // Null = no tax on this invoice.
    taxName: varchar('tax_name', { length: 40 }),
    taxRate: decimal('tax_rate', { precision: 5, scale: 2 }),

    subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull().default('0.00'),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).notNull().default('0.00'),
    taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).notNull().default('0.00'),
    total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0.00'),
    amountPaid: decimal('amount_paid', { precision: 12, scale: 2 }).notNull().default('0.00'),

    // Printed on the invoice, for the client.
    notes: text('notes'),

    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    issuedAt: datetime('issued_at'),
    issuedByUserId: varchar('issued_by_user_id', { length: 36 }),
    paidAt: datetime('paid_at'),
    voidedAt: datetime('voided_at'),
    voidReason: varchar('void_reason', { length: 500 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    patientIdx: index('invoices_patient_idx').on(table.patientId, table.status),
    bookingIdx: index('invoices_booking_idx').on(table.bookingId),
    statusIdx: index('invoices_status_idx').on(table.status, table.dueDate),
  }),
);

/**
 * One line of an invoice or a payout statement (the two share a shape; see
 * invoiceLines and payoutLines). quantity x unitPrice, less the line's own
 * discount, is `amount`. A SHIFT line points at the shift it bills, which is
 * how the same shift is kept off a second live invoice; a monthly-rate line
 * covers a period of a booking instead.
 */
const lineColumns = () => ({
  id: varchar('id', { length: 36 }).primaryKey(),
  position: int('position').notNull(),
  kind: mysqlEnum('kind', billingLineKindEnum).notNull(),
  description: varchar('description', { length: 300 }).notNull(),
  serviceDate: date('service_date', { mode: 'string' }),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: mysqlEnum('unit', billingUnitEnum).notNull(),
  // Negative for a credit (an ADJUSTMENT).
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
  discountType: mysqlEnum('discount_type', discountTypeEnum),
  discountValue: decimal('discount_value', { precision: 12, scale: 2 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  shiftId: varchar('shift_id', { length: 36 }),
  bookingId: varchar('booking_id', { length: 36 }),
  caregiverId: varchar('caregiver_id', { length: 36 }),
  // For a monthly-rate line: the days it covers.
  periodStart: date('period_start', { mode: 'string' }),
  periodEnd: date('period_end', { mode: 'string' }),
});

export const invoiceLines = mysqlTable(
  'invoice_lines',
  {
    ...lineColumns(),
    invoiceId: varchar('invoice_id', { length: 36 }).notNull(),
    // Reimbursed expenses can be left out of tax.
    taxable: boolean('taxable').notNull().default(true),
  },
  (table) => ({
    invoiceIdx: index('invoice_lines_invoice_idx').on(table.invoiceId, table.position),
    shiftIdx: index('invoice_lines_shift_idx').on(table.shiftId),
    bookingIdx: index('invoice_lines_booking_idx').on(table.bookingId),
  }),
);

/**
 * Money against an invoice: a payment (positive) or a refund / reversal
 * (negative). Staff record cash, transfers and cheques by hand; PayHere
 * payments are written by the payment notification and carry its payment id,
 * which is unique so a repeated notification is never counted twice.
 */
export const invoicePayments = mysqlTable(
  'invoice_payments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    method: mysqlEnum('method', paymentMethodEnum).notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    reference: varchar('reference', { length: 120 }),
    note: varchar('note', { length: 500 }),
    // PayHere's payment_id; a chargeback reversal adds ":chargeback".
    externalId: varchar('external_id', { length: 80 }),
    recordedByUserId: varchar('recorded_by_user_id', { length: 36 }),
    // Milliseconds: two entries made in one second still list in the order they were made.
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    invoiceIdx: index('invoice_payments_invoice_idx').on(table.invoiceId),
    externalUnique: uniqueIndex('invoice_payments_external_unique').on(table.externalId),
  }),
);

/**
 * One attempt to pay online. Its id is the order_id PayHere echoes back, so a
 * notification can only ever settle the invoice and amount it was made for.
 */
export const payhereCheckoutStatusEnum = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'CHARGEDBACK'] as const;
export const payhereCheckouts = mysqlTable(
  'payhere_checkouts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('LKR'),
    mode: mysqlEnum('mode', payhereModeEnum).notNull(),
    status: mysqlEnum('status', payhereCheckoutStatusEnum).notNull().default('PENDING'),
    paymentId: varchar('payment_id', { length: 64 }),
    method: varchar('method', { length: 20 }),
    statusMessage: varchar('status_message', { length: 255 }),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    invoiceIdx: index('payhere_checkouts_invoice_idx').on(table.invoiceId),
  }),
);

export const invoiceEventTypeEnum = [
  'CREATED',
  'UPDATED',
  'LINES_CHANGED',
  'ISSUED',
  'SENT',
  'PAYMENT',
  'REFUND',
  'PAYMENT_DELETED',
  'PAID',
  'REOPENED',
  'VOIDED',
  'NOTE',
] as const;
export type InvoiceEventType = (typeof invoiceEventTypeEnum)[number];

export const invoiceEvents = mysqlTable(
  'invoice_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 }).notNull(),
    type: mysqlEnum('type', invoiceEventTypeEnum).notNull(),
    note: text('note'),
    actorUserId: varchar('actor_user_id', { length: 36 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    invoiceIdx: index('invoice_events_invoice_idx').on(table.invoiceId, table.createdAt),
  }),
);

/**
 * What CareLink owes one caregiver for one period: the shifts they worked
 * (booked or covering), at the booking's pay rate, plus any allowances or
 * deductions staff add.
 *
 * - DRAFT     editable.
 * - APPROVED  checked and locked; the caregiver can see it.
 * - PAID      staff recorded the transfer; the caregiver is told.
 * - VOID      dropped (from DRAFT or APPROVED), its shifts free to go on another.
 */
export const payoutStatements = mysqlTable(
  'payout_statements',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    reference: varchar('reference', { length: 16 }).notNull().unique(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', payoutStatusEnum).notNull().default('DRAFT'),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    total: decimal('total', { precision: 12, scale: 2 }).notNull().default('0.00'),
    notes: text('notes'),
    paidOn: date('paid_on', { mode: 'string' }),
    paymentMethod: mysqlEnum('payment_method', paymentMethodEnum),
    paymentReference: varchar('payment_reference', { length: 120 }),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    approvedAt: datetime('approved_at'),
    approvedByUserId: varchar('approved_by_user_id', { length: 36 }),
    paidAt: datetime('paid_at'),
    paidByUserId: varchar('paid_by_user_id', { length: 36 }),
    voidedAt: datetime('voided_at'),
    voidReason: varchar('void_reason', { length: 500 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('payout_statements_caregiver_idx').on(table.caregiverId, table.periodStart),
    statusIdx: index('payout_statements_status_idx').on(table.status),
  }),
);

export const payoutLines = mysqlTable(
  'payout_lines',
  {
    ...lineColumns(),
    statementId: varchar('statement_id', { length: 36 }).notNull(),
  },
  (table) => ({
    statementIdx: index('payout_lines_statement_idx').on(table.statementId, table.position),
    shiftIdx: index('payout_lines_shift_idx').on(table.shiftId),
    bookingIdx: index('payout_lines_booking_idx').on(table.bookingId),
  }),
);
