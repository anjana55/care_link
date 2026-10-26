import { mysqlTable, varchar, text, int, date, datetime, boolean, json, mysqlEnum, index, uniqueIndex, decimal } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { caregivers } from './caregivers.schema';

/*
 * The international paths:
 *
 *  - overseas employers (agencies, care homes, hospitals, families abroad)
 *    looking for caregivers from Sri Lanka. They do not get accounts: they
 *    send an enquiry and staff make every introduction, the same staff-mediated
 *    model as local care requests. The platform's revenue on this path is a
 *    placement fee the employer pays once a caregiver starts work.
 *  - local caregivers preparing for work abroad: an overseas-readiness record,
 *    the platform's own training programmes (English, basic caregiving), and a
 *    profile they can choose to share publicly - with their first name and
 *    photo - once they have given consent and staff have reviewed it.
 */

// --- employer enquiries ------------------------------------------------------

export const employerTypeEnum = ['RECRUITMENT_AGENCY', 'CARE_HOME', 'HOSPITAL', 'HOME_CARE_PROVIDER', 'PRIVATE_FAMILY', 'OTHER'] as const;
export type EmployerType = (typeof employerTypeEnum)[number];

export const visaSponsorshipEnum = ['YES', 'NO', 'UNSURE'] as const;
export type VisaSponsorship = (typeof visaSponsorshipEnum)[number];

/**
 * NEW: waiting for staff. IN_PROGRESS: staff are talking to the employer and
 * shortlisting. INTRODUCED: candidates have been put forward. PLACED: a
 * caregiver has started work (the placement fee is due). CLOSED: no placement.
 */
export const employerEnquiryStatusEnum = ['NEW', 'IN_PROGRESS', 'INTRODUCED', 'PLACED', 'CLOSED'] as const;
export type EmployerEnquiryStatus = (typeof employerEnquiryStatusEnum)[number];

export const employerEnquiries = mysqlTable(
  'employer_enquiries',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Read out on calls and quoted in emails: "enquiry IE-7K2Q9M".
    reference: varchar('reference', { length: 16 }).notNull().unique(),
    organisationName: varchar('organisation_name', { length: 200 }).notNull(),
    organisationType: mysqlEnum('organisation_type', employerTypeEnum).notNull(),
    // ISO 3166-1 alpha-2, where the caregivers would work.
    country: varchar('country', { length: 2 }).notNull(),
    contactName: varchar('contact_name', { length: 150 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    // International format as typed ("+81 90 1234 5678").
    phone: varchar('phone', { length: 32 }),
    website: varchar('website', { length: 255 }),
    rolesCount: int('roles_count').notNull(),
    // Care types, as the local platform names them.
    careSettings: json('care_settings').$type<string[]>().notNull(),
    // Free text: "English (fluent), basic Japanese".
    languages: varchar('languages', { length: 255 }),
    startTimeframe: varchar('start_timeframe', { length: 100 }),
    visaSponsorship: mysqlEnum('visa_sponsorship', visaSponsorshipEnum).notNull().default('UNSURE'),
    message: text('message'),
    // Set when the enquiry came from a shared caregiver profile ("Ask about Nadeesha").
    caregiverId: varchar('caregiver_id', { length: 36 }).references(() => caregivers.id),
    status: mysqlEnum('status', employerEnquiryStatusEnum).notNull().default('NEW'),
    // Internal: never shown to the employer or a caregiver.
    staffNote: text('staff_note'),
    // Agreed fee, recorded by staff when the enquiry is marked PLACED.
    placementFeeAmount: decimal('placement_fee_amount', { precision: 12, scale: 2, mode: 'number' }),
    placementFeeCurrency: varchar('placement_fee_currency', { length: 3 }),
    assignedToUserId: varchar('assigned_to_user_id', { length: 36 }),
    // The employer ticked "contact me about this enquiry" and accepted the privacy notice.
    consentAcceptedAt: datetime('consent_accepted_at').notNull(),
    language: varchar('language', { length: 5 }).notNull().default('en'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('employer_enquiries_status_idx').on(table.status, table.createdAt),
    caregiverIdx: index('employer_enquiries_caregiver_idx').on(table.caregiverId),
  }),
);

// --- caregiver overseas readiness -------------------------------------------

/**
 * One row per caregiver who has opened the Work abroad section. Languages and
 * qualifications are not repeated here - they live on the caregiver's
 * profile, where staff already verify them.
 */
export const caregiverOverseasProfiles = mysqlTable('caregiver_overseas_profiles', {
  caregiverId: varchar('caregiver_id', { length: 36 })
    .primaryKey()
    .references(() => caregivers.id),
  openToOverseas: boolean('open_to_overseas').notNull().default(false),
  // ISO 3166-1 alpha-2 codes, in the caregiver's order of preference.
  targetCountries: json('target_countries').$type<string[]>().notNull(),
  // Whether they hold a passport, and until when. The number itself stays on
  // the caregiver record (staff only) and never appears here or publicly.
  passportHeld: boolean('passport_held'),
  passportExpiry: date('passport_expiry', { mode: 'string' }),
  availableFrom: date('available_from', { mode: 'string' }),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// --- training -----------------------------------------------------------------

export const trainingCategoryEnum = ['ENGLISH', 'CAREGIVING', 'OTHER'] as const;
export type TrainingCategory = (typeof trainingCategoryEnum)[number];

export const trainingFormatEnum = ['IN_PERSON', 'ONLINE', 'BLENDED'] as const;
export type TrainingFormat = (typeof trainingFormatEnum)[number];

/** A programme the platform runs. English text is required; Sinhala and Tamil fall back to it. */
export const trainingProgrammes = mysqlTable('training_programmes', {
  id: varchar('id', { length: 36 }).primaryKey(),
  category: mysqlEnum('category', trainingCategoryEnum).notNull(),
  format: mysqlEnum('format', trainingFormatEnum).notNull(),
  titleEn: varchar('title_en', { length: 200 }).notNull(),
  titleSi: varchar('title_si', { length: 200 }),
  titleTa: varchar('title_ta', { length: 200 }),
  descriptionEn: text('description_en').notNull(),
  descriptionSi: text('description_si'),
  descriptionTa: text('description_ta'),
  // Free text so it can say "6 weeks, Saturdays" as well as "40 hours".
  duration: varchar('duration', { length: 100 }),
  // LKR. Null = free.
  feeLkr: decimal('fee_lkr', { precision: 12, scale: 2, mode: 'number' }),
  nextStartDate: date('next_start_date', { mode: 'string' }),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: int('sort_order').notNull().default(0),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * INTERESTED: the caregiver asked about it. ENROLLED: staff confirmed a place.
 * COMPLETED: staff recorded completion - shown on the caregiver's shared
 * profile. WITHDRAWN: either side stopped it.
 */
export const trainingEnrolmentStatusEnum = ['INTERESTED', 'ENROLLED', 'COMPLETED', 'WITHDRAWN'] as const;
export type TrainingEnrolmentStatus = (typeof trainingEnrolmentStatusEnum)[number];

export const trainingEnrolments = mysqlTable(
  'training_enrolments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    programmeId: varchar('programme_id', { length: 36 })
      .notNull()
      .references(() => trainingProgrammes.id),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    status: mysqlEnum('status', trainingEnrolmentStatusEnum).notNull().default('INTERESTED'),
    completedAt: date('completed_at', { mode: 'string' }),
    staffNote: varchar('staff_note', { length: 500 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    oncePerProgramme: uniqueIndex('training_enrolments_programme_caregiver_unique').on(table.programmeId, table.caregiverId),
    caregiverIdx: index('training_enrolments_caregiver_idx').on(table.caregiverId),
  }),
);

// --- shared caregiver profiles --------------------------------------------------

/**
 * DRAFT: never submitted. PENDING_REVIEW: waiting for staff (and offline).
 * APPROVED: live while the caregiver keeps sharing switched on. REJECTED:
 * staff sent it back with a note.
 */
export const sharedProfileStatusEnum = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type SharedProfileStatus = (typeof sharedProfileStatusEnum)[number];

/**
 * A caregiver's opt-in public profile. Separate from anonymous search on
 * purpose: search never shows a name or a face; this shows a first name and
 * photo, and only for a caregiver who has given consent, chosen to share,
 * and been reviewed by staff. Any change to what it shows sends it back for
 * review, and it is offline until approved again.
 */
export const sharedProfiles = mysqlTable(
  'shared_profiles',
  {
    caregiverId: varchar('caregiver_id', { length: 36 })
      .primaryKey()
      .references(() => caregivers.id),
    // The link: /talent/<slug>. Random, unguessable, and replaceable - a new
    // slug kills every copy of the old link.
    slug: varchar('slug', { length: 24 }).notNull().unique(),
    // The caregiver's own switch. Off = offline whatever the review status.
    isShared: boolean('is_shared').notNull().default(false),
    firstName: varchar('first_name', { length: 60 }).notNull(),
    headline: varchar('headline', { length: 120 }),
    bio: text('bio'),
    photoKey: varchar('photo_key', { length: 255 }),
    photoMimeType: varchar('photo_mime_type', { length: 50 }),
    status: mysqlEnum('status', sharedProfileStatusEnum).notNull().default('DRAFT'),
    reviewNote: varchar('review_note', { length: 500 }),
    reviewedByUserId: varchar('reviewed_by_user_id', { length: 36 }),
    reviewedAt: datetime('reviewed_at'),
    // The consent the caregiver gave, and which wording they agreed to.
    // Withdrawing consent clears these and switches sharing off.
    consentAcceptedAt: datetime('consent_accepted_at'),
    consentVersion: varchar('consent_version', { length: 20 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('shared_profiles_status_idx').on(table.status),
  }),
);
