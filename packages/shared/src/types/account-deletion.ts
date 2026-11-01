/**
 * "Delete my account" - the person's side (app and website) and the staff
 * queue. See apps/api/src/account-deletion.
 */

/** Days between asking and erasure, in which staff can still cancel. */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;

/** POST /me/account/deletion: when the personal data will be erased. */
export interface AccountDeletionReceipt {
  /** ISO time. Erasure waits beyond this while anything is still open (see OpenItems). */
  eraseAfter: string;
}

/**
 * What still has to be settled before the data can go. Erasure waits until
 * every count is 0; staff settle them in the usual places.
 */
export interface AccountOpenItems {
  /** Caregiver: shifts still to work. */
  upcomingShifts: number;
  /** Caregiver: payouts not yet paid (draft or approved). */
  unpaidPayouts: number;
  /** Caregiver: a placement abroad that hasn't ended. */
  activePlacements: number;
  /** Client: bookings not yet completed or cancelled. */
  activeBookings: number;
  /** Client: invoices drafted or issued but not paid. */
  unpaidInvoices: number;
  /** Client: care requests still being handled. */
  openCareRequests: number;
  /** Either: billing adjustments still open. */
  openAdjustments: number;
}

export type AccountDeletionStatus = 'PENDING' | 'CANCELLED' | 'ERASED';

/** A row of the staff queue (GET /account-deletions). */
export interface StaffAccountDeletion {
  id: string;
  role: 'CAREGIVER' | 'PATIENT_GUARDIAN';
  status: AccountDeletionStatus;
  /** Who asked, while the account still exists; null once erased. */
  name: string | null;
  /** The caregiver's registration number, or the sign-in email or phone; null once erased. */
  reference: string | null;
  caregiverId: string | null;
  patientId: string | null;
  requestedAt: string;
  eraseAfter: string;
  cancelledAt: string | null;
  erasedAt: string | null;
  /** Pending requests only: what is holding erasure back. */
  openItems: AccountOpenItems | null;
}

export const openItemCount = (items: AccountOpenItems | null): number =>
  items ? Object.values(items).reduce((sum, n) => sum + n, 0) : 0;
