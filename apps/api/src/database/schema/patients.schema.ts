import { mysqlTable, varchar, datetime, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

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
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('patients_user_idx').on(table.userId),
  }),
);
