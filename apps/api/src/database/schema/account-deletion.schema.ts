import { mysqlTable, varchar, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * "Delete my account" (the app and the website), a store requirement.
 *
 * A request locks the account at once: signed out, unable to sign in, push
 * stopped, and a caregiver out of search. 14 days later (`erase_after`), if
 * nothing is still open - shifts, payouts, bookings, invoices - the personal
 * data is erased in place; until then staff may cancel it, which restores
 * the account as it was (`previous_status`).
 *
 * The row itself holds no personal data: who it was is read from the user
 * while it still exists, and after erasure only the ids and dates remain.
 */
export const accountDeletionRoleEnum = ['CAREGIVER', 'PATIENT_GUARDIAN'] as const;
export const accountDeletionStatusEnum = ['PENDING', 'CANCELLED', 'ERASED'] as const;
export type AccountDeletionStatus = (typeof accountDeletionStatusEnum)[number];

export const accountDeletionRequests = mysqlTable(
  'account_deletion_requests',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', accountDeletionRoleEnum).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }),
    patientId: varchar('patient_id', { length: 36 }),
    status: mysqlEnum('status', accountDeletionStatusEnum).notNull().default('PENDING'),
    requestedAt: datetime('requested_at').notNull(),
    eraseAfter: datetime('erase_after').notNull(),
    // The caregiver's or client's status before the lock set it to INACTIVE.
    previousStatus: varchar('previous_status', { length: 32 }),
    cancelledAt: datetime('cancelled_at'),
    cancelledByUserId: varchar('cancelled_by_user_id', { length: 36 }),
    erasedAt: datetime('erased_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    dueIdx: index('account_deletion_requests_due_idx').on(table.status, table.eraseAfter),
    userIdx: index('account_deletion_requests_user_idx').on(table.userId),
  }),
);
