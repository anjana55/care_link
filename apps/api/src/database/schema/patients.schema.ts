import { mysqlTable, varchar, datetime, date, index, int, mysqlEnum, text } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
// Both are leaf schema modules - caregivers.schema imports only ./locations.schema
// and drizzle-orm - so this is not a cycle. Sharing one constant means a future
// option cannot land on one table and not the other.
import { genderEnum } from './caregivers.schema';

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
 * for caregiver self-registration (see caregivers.schema.ts).
 *
 * The registration/login endpoints, contact requests and saved caregivers
 * that would populate most of this are still a later phase. What is here now
 * is the part staff need in order to correct a record: the profile block
 * below, filled in from the clients detail page.
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
    // --- staff-editable profile (PATCH /patients/:id) ---------------------
    // Nullable throughout, unlike the caregiver equivalents. A client does not
    // arrive through an intake form: both self-registration paths
    // (AuthService.registerPatient and its WhatsApp twin) write only a name, a
    // phone and consent, so every existing row and every future WhatsApp signup
    // has all of these null.
    permanentAddress: text('permanent_address'),
    // `date`, not `datetime`, and the DTO carries 'YYYY-MM-DD' - what a date
    // input sends - which mysql2 passes straight through. Do not "fix" this
    // into a Date object on write: mysql2 serialises Dates in the connection's
    // local timezone, which shifts the stored day by one west of UTC.
    dateOfBirth: date('date_of_birth'),
    gender: mysqlEnum('gender', genderEnum),
    // Deliberately not unique, unlike caregivers.nic: a unique index would turn
    // two staff mistyping the same NIC into a raw ER_DUP_ENTRY 500 unless a
    // pre-check helper shipped alongside it. MySQL allows unlimited NULLs in a
    // unique index, so tightening this later is non-breaking.
    nic: varchar('nic', { length: 20 }),
    // Location: submitted as an id pair, stored alongside English display
    // caches written by the service from the referenced rows (resolveLocationRefs).
    // The ids are the source of truth; the caches exist so a staff list never
    // needs a join. patients keeps province, which caregivers resolves and
    // discards.
    districtId: int('district_id'),
    cityId: int('city_id'),
    district: varchar('district', { length: 100 }),
    city: varchar('city', { length: 100 }),
    province: varchar('province', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    // Free-text staff note (how they were referred, what needs chasing).
    // Distinct from consentAcceptedAt, which stays self-service only.
    notes: text('notes'),
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
