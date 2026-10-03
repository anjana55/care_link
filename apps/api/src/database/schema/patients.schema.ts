import { mysqlTable, varchar, datetime, index, mysqlEnum } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * The lifecycle of a client record, mirroring the caregiver status ladder
 * (see caregivers.schema.ts) but much shorter: a patient/guardian has no
 * documents, qualifications or references to clear, so the caregiver's
 * DOCUMENT_PENDING and UNDER_VERIFICATION rungs have no counterpart here.
 *
 * PENDING_REVIEW is the registration-time state. Self-registration
 * (AuthService.registerPatient, WhatsappAuthService.registerPatient)
 * inserts straight into it, and staff promote a client to ACTIVE from the
 * staff app. It is deliberately not derived from users.emailVerifiedAt:
 * confirming an email proves the address is real, not that the account has
 * been reviewed by the platform.
 */
export const clientStatusEnum = ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type ClientStatus = (typeof clientStatusEnum)[number];

/** Legal next states per current status. Enforced in PatientsService.updateStatus. */
export const CLIENT_STATUS_TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  PENDING_REVIEW: ['ACTIVE', 'INACTIVE'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE'],
  SUSPENDED: ['ACTIVE'],
};

/**
 * A patient/guardian's profile, linked 1:1 to a `users` row with
 * role = 'PATIENT_GUARDIAN' - the same userId-linking pattern already used
 * for caregiver self-registration (see caregivers.schema.ts). Kept minimal
 * for now: this table exists so the PATIENT_GUARDIAN role has somewhere to
 * attach domain data, but the registration/login endpoints, contact
 * requests, saved caregivers, etc. that would populate and use it are a
 * later phase - not built in this pass.
 */
export const patients = mysqlTable(
  'patients',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull().unique(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    // Mirrors caregivers.consentAcceptedAt - explicit data-processing
    // consent captured at self-registration time (see AuthService.registerPatient).
    consentAcceptedAt: datetime('consent_accepted_at'),
    // Defaults to PENDING_REVIEW so a row backfilled by the migration lands
    // in the least-privileged state rather than silently appearing active.
    // Both self-registration services set it explicitly.
    status: mysqlEnum('status', clientStatusEnum).notNull().default('PENDING_REVIEW'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('patients_user_idx').on(table.userId),
    statusIdx: index('patients_status_idx').on(table.status),
  }),
);
