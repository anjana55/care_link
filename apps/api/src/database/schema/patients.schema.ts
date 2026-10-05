import { mysqlTable, varchar, datetime, date, index, int, mysqlEnum, smallint, text } from 'drizzle-orm/mysql-core';
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
 * Who is registering: the person who needs care, or someone arranging it for
 * them (a family member, friend...). Decides whether the care-recipient fields
 * below describe someone other than the account holder.
 */
export const registrantTypeEnum = ['SELF', 'GUARDIAN'] as const;
export type RegistrantType = (typeof registrantTypeEnum)[number];

/** The guardian's relationship to the person needing care. Only set for GUARDIAN registrations. */
export const recipientRelationshipEnum = ['PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'OTHER_RELATIVE', 'FRIEND', 'OTHER'] as const;
export type RecipientRelationship = (typeof recipientRelationshipEnum)[number];

export const recipientGenderEnum = ['MALE', 'FEMALE', 'OTHER'] as const;
export type RecipientGender = (typeof recipientGenderEnum)[number];

/** How staff should reach the client first. EMAIL is only valid for accounts that have an email address. */
export const contactMethodEnum = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
export type ContactMethod = (typeof contactMethodEnum)[number];

export const contactTimeEnum = ['ANYTIME', 'MORNING', 'AFTERNOON', 'EVENING'] as const;
export type ContactTime = (typeof contactTimeEnum)[number];

/** Mirrors the caregiver availability flags (day / night / 24h live-in) so a client can be matched against them. */
export const careScheduleEnum = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
export type CareSchedule = (typeof careScheduleEnum)[number];

export const careStartEnum = ['IMMEDIATELY', 'WITHIN_WEEK', 'WITHIN_MONTH', 'JUST_EXPLORING'] as const;
export type CareStart = (typeof careStartEnum)[number];

export const caregiverGenderPreferenceEnum = ['NO_PREFERENCE', 'MALE', 'FEMALE'] as const;
export type CaregiverGenderPreference = (typeof caregiverGenderPreferenceEnum)[number];

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
    // Nullable throughout, unlike the caregiver equivalents. Only staff fill
    // these in, from the clients detail page: self-registration captures the
    // intake block below, not the staff profile block here, so every existing
    // row and every new signup has all of these null until someone edits it.
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

    // --- Intake, captured at self-registration (PatientProfileDto) ---------
    // Populated by buildPatientIntake from both the email and the WhatsApp
    // sign-up DTOs. Nullable only because clients registered before this
    // existed have none of it - the columns themselves are nullable, the DTO
    // is what makes them mandatory for a new registration.
    registrantType: mysqlEnum('registrant_type', registrantTypeEnum),
    // Null for SELF registrations - the care recipient is the account holder.
    recipientName: varchar('recipient_name', { length: 255 }),
    recipientRelationship: mysqlEnum('recipient_relationship', recipientRelationshipEnum),
    recipientAge: smallint('recipient_age', { unsigned: true }),
    recipientGender: mysqlEnum('recipient_gender', recipientGenderEnum),

    // --- How to reach them -----------------------------------------------
    alternatePhone: varchar('alternate_phone', { length: 20 }),
    preferredContactMethod: mysqlEnum('preferred_contact_method', contactMethodEnum),
    preferredContactTime: mysqlEnum('preferred_contact_time', contactTimeEnum),

    // --- Where care is needed --------------------------------------------
    // Reuses the district_id/city_id pair declared above, so a client can be
    // matched to caregivers by location; careAddress is the fuller description.
    careAddress: varchar('care_address', { length: 500 }),

    // --- What care, and when ---------------------------------------------
    careNeeds: text('care_needs'),
    careSchedule: mysqlEnum('care_schedule', careScheduleEnum),
    careStart: mysqlEnum('care_start', careStartEnum),
    preferredCaregiverGender: mysqlEnum('preferred_caregiver_gender', caregiverGenderPreferenceEnum),

    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('patients_user_idx').on(table.userId),
    statusIdx: index('patients_status_idx').on(table.status),
    // The staff Clients list filters by place first.
    locationIdx: index('patients_location_idx').on(table.districtId, table.cityId),
  }),
);
