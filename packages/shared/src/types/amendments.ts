/**
 * Booking corrections (amendments): changing work that already happened -
 * or that is already billed - after the fact, without rewriting any document
 * the client or caregiver has seen.
 *
 * Staff describe the correction (AmendBookingInput), the API previews what it
 * does to every invoice and pay statement the work is on (AmendmentPreview),
 * staff pick how each unpaid issued invoice is handled, and the API applies it.
 */

export type AmendShiftStatus = 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export interface AmendShiftInput {
  shiftId: string;
  /** Colombo wall-clock 'YYYY-MM-DDTHH:MM'. */
  start?: string;
  end?: string;
  /** COMPLETED / MISSED once the shift has started; SCHEDULED / CANCELLED before. */
  status?: AmendShiftStatus;
  /** Who actually worked it. */
  caregiverId?: string;
  /** The shift's own rates: a type and amount sets one, null clears it back to the booking's. */
  rateType?: 'HOURLY' | 'DAILY' | null;
  rateAmount?: string | null;
  payRateType?: 'HOURLY' | 'DAILY' | null;
  payRateAmount?: string | null;
  note?: string | null;
}

/** A shift that happened but was never on the roster. Added as COMPLETED. */
export interface AmendAddShiftInput {
  start: string;
  end: string;
  caregiverId?: string;
  rateType?: 'HOURLY' | 'DAILY' | null;
  rateAmount?: string | null;
  payRateType?: 'HOURLY' | 'DAILY' | null;
  payRateAmount?: string | null;
  note?: string | null;
}

/**
 * How one invoice takes the correction.
 * - REFRESH  a draft: its lines are rebuilt in place.
 * - REPLACE  an issued invoice with nothing paid: voided, and a corrected
 *            draft copy made to issue in its place.
 * - CARRY    the difference waits as an adjustment for the next invoice /
 *            statement; the document itself stays as it is.
 * - REOPEN   an approved pay statement goes back to draft and is rebuilt.
 * - NONE     the correction does not change what it comes to.
 */
export type AmendmentDocumentAction = 'REFRESH' | 'REPLACE' | 'CARRY' | 'REOPEN' | 'NONE';

export interface AmendBookingInput {
  reason: string;
  /** The booking's own rate amounts, when the agreed rate itself was wrong. The rate type cannot change here. */
  rateAmount?: string;
  payRateAmount?: string;
  shifts?: AmendShiftInput[];
  addShifts?: AmendAddShiftInput[];
  /** Apply only: invoice id -> REPLACE or CARRY, for issued invoices with nothing paid. Defaults to REPLACE. */
  invoiceActions?: Record<string, 'REPLACE' | 'CARRY'>;
  /**
   * Close a confirmed booking as part of the correction: its upcoming
   * scheduled shifts are cancelled - and any invoice or pay statement that
   * already bills them is adjusted - then it is marked completed or cancelled.
   */
  close?: 'COMPLETED' | 'CANCELLED';
  /** Open issue reports on this booking that the correction answers; applying resolves them. */
  issueIds?: string[];
  /** With issueIds: the answer sent to whoever reported them. */
  reply?: string;
}

export interface AmendmentLineChange {
  lineId: string;
  description: string;
  serviceDate: string | null;
  before: string;
  /** Null: the line goes (the shift is no longer billed on this document). */
  after: string | null;
}

export interface AmendmentDocumentImpact {
  kind: 'INVOICE' | 'PAYOUT';
  id: string;
  /** INV-0012, a statement reference, or null for a draft invoice. */
  label: string | null;
  status: string;
  /** The client or caregiver it is for. */
  partyName: string | null;
  /** What the whole document comes to before and after (with its own discount and tax). */
  before: string;
  after: string;
  difference: string;
  action: AmendmentDocumentAction;
  /** The actions staff may choose between (more than one only for an unpaid issued invoice). */
  choices: AmendmentDocumentAction[];
  lines: AmendmentLineChange[];
}

export interface AmendmentAdjustmentPreview {
  side: 'CLIENT' | 'CAREGIVER';
  partyName: string | null;
  /** For an invoice: after its discount, before tax - the next invoice adds tax if this one was taxed. */
  amount: string;
  taxable: boolean;
  description: string;
  sourceLabel: string | null;
}

export interface AmendmentShiftChange {
  shiftId: string | null;
  date: string;
  changes: string[];
}

export interface AmendmentPreview {
  changes: AmendmentShiftChange[];
  documents: AmendmentDocumentImpact[];
  adjustments: AmendmentAdjustmentPreview[];
  /** Shifts that will need billing / paying and are on no document yet. */
  unbilled: { client: string[]; pay: string[] };
  warnings: string[];
  /** When the correction also closes the booking: how, and how many upcoming shifts that cancels. */
  close?: { status: 'COMPLETED' | 'CANCELLED'; upcomingCancelled: number };
}

/** What a correction did, as stored and shown in the booking's history. */
export interface BookingAmendmentSummary {
  changes: AmendmentShiftChange[];
  documents: { kind: 'INVOICE' | 'PAYOUT'; id: string; label: string | null; action: AmendmentDocumentAction; difference: string; replacementId?: string }[];
  adjustments: { id: string; side: 'CLIENT' | 'CAREGIVER'; amount: string; partyName: string | null }[];
  /** Issue reports this correction resolved. */
  issueIds?: string[];
}

export type BillingAdjustmentStatus = 'OPEN' | 'APPLIED' | 'SETTLED' | 'CANCELLED';

export interface BillingAdjustmentView {
  id: string;
  side: 'CLIENT' | 'CAREGIVER';
  partyName: string | null;
  bookingId: string;
  amount: string;
  description: string;
  sourceLabel: string | null;
  /** APPLIED: on a live invoice / statement right now (see `appliedTo`). */
  status: BillingAdjustmentStatus;
  appliedTo: { kind: 'INVOICE' | 'PAYOUT'; id: string; label: string | null; status: string } | null;
  closedNote: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface BookingAmendmentView {
  id: string;
  reason: string;
  summary: BookingAmendmentSummary;
  actor: { id: string; fullName: string } | null;
  createdAt: string;
}

// --- issue reports: clients and caregivers flagging a problem -------------------------

export type IssueReportCategory = 'TIMES' | 'DID_NOT_HAPPEN' | 'WRONG_CAREGIVER' | 'CHARGE' | 'PAY' | 'CARE_PLAN' | 'OTHER';
export type IssueReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
/** What a client may report (pay is the caregiver's business), and what a caregiver may. */
/** CARE_PLAN: a care-plan record the client can no longer change (past its cut-off) is wrong. */
export const CLIENT_ISSUE_CATEGORIES: IssueReportCategory[] = ['TIMES', 'DID_NOT_HAPPEN', 'WRONG_CAREGIVER', 'CHARGE', 'CARE_PLAN', 'OTHER'];
export const CAREGIVER_ISSUE_CATEGORIES: IssueReportCategory[] = ['TIMES', 'DID_NOT_HAPPEN', 'PAY', 'OTHER'];
export const MAX_ISSUE_MESSAGE = 1000;

/** POST /me/bookings/:id/issues (client) and POST /me/shifts/:id/issues (caregiver). */
export interface CreateIssueReportBody {
  category: IssueReportCategory;
  message: string;
  /** Client only: the shift it is about, if it is about one. */
  shiftId?: string;
}

/** A report as its reporter sees it (GET /me/issues). */
export interface MyIssueReport {
  id: string;
  bookingId: string;
  bookingReference: string;
  shiftId: string | null;
  shiftStartsAt: string | null;
  category: IssueReportCategory;
  message: string;
  status: IssueReportStatus;
  /** Staff's answer, once closed. */
  resolutionNote: string | null;
  createdAt: string;
  closedAt: string | null;
}

/** A report as staff see it on the booking. */
export interface IssueReportView extends MyIssueReport {
  reporterRole: 'CLIENT' | 'CAREGIVER';
  reporterName: string | null;
  amendmentId: string | null;
  closedBy: { id: string; fullName: string } | null;
}
