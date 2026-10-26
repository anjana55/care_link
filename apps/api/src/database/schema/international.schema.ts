import { mysqlTable, varchar, text, int, date, datetime, boolean, json, mysqlEnum, index, uniqueIndex, decimal, primaryKey } from 'drizzle-orm/mysql-core';
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
/**
 * PENDING_REVIEW: signed up, waiting for staff to check the organisation.
 * VERIFIED: may ask for interviews. REJECTED: staff could not verify it (note
 * says why). SUSPENDED: staff stopped the account.
 */
export const employerStatusEnum = ['PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export type EmployerStatus = (typeof employerStatusEnum)[number];

/**
 * An overseas employer's organisation, owned by one EMPLOYER login. Staff
 * verify it (that it is a real organisation, recruiting lawfully) before it can
 * ask for interviews. Employers only ever see caregivers through the profiles
 * caregivers chose to share, and never their contact details.
 */
export const employers = mysqlTable(
  'employers',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .unique(),
    organisationName: varchar('organisation_name', { length: 200 }).notNull(),
    organisationType: mysqlEnum('organisation_type', employerTypeEnum).notNull(),
    country: varchar('country', { length: 2 }).notNull(),
    contactName: varchar('contact_name', { length: 150 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    website: varchar('website', { length: 255 }),
    // The organisation's registration or licence number in its own country, if it has one.
    companyRegistrationNumber: varchar('company_registration_number', { length: 100 }),
    status: mysqlEnum('status', employerStatusEnum).notNull().default('PENDING_REVIEW'),
    reviewNote: varchar('review_note', { length: 500 }),
    reviewedByUserId: varchar('reviewed_by_user_id', { length: 36 }),
    reviewedAt: datetime('reviewed_at'),
    consentAcceptedAt: datetime('consent_accepted_at').notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('employers_status_idx').on(table.status, table.createdAt),
  }),
);

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
    // Set when a signed-in employer sent it, or when staff verified the employer
    // and linked their earlier enquiries (same email address).
    employerId: varchar('employer_id', { length: 36 }).references(() => employers.id),
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
    employerIdx: index('employer_enquiries_employer_idx').on(table.employerId),
  }),
);

/**
 * PROPOSED: staff put the caregiver forward for the enquiry.
 * INTERVIEW_REQUESTED: the employer asked to interview them.
 * INTERVIEW_SCHEDULED: staff arranged it (interviewAt).
 * SELECTED: the employer wants to hire them.
 * PLACED: the caregiver started work - the enquiry's placement fee is due.
 * NOT_PROCEEDING: either side stopped (the note says why).
 */
export const candidateStatusEnum = ['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'PLACED', 'NOT_PROCEEDING'] as const;
export type CandidateStatus = (typeof candidateStatusEnum)[number];

export const candidateSourceEnum = ['STAFF', 'EMPLOYER'] as const;
export type CandidateSource = (typeof candidateSourceEnum)[number];

/**
 * A caregiver put forward for (or asked about on) an employer enquiry. Only
 * caregivers with a live shared profile can be candidates: that profile is
 * the only way an employer ever sees them.
 */
export const enquiryCandidates = mysqlTable(
  'enquiry_candidates',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    enquiryId: varchar('enquiry_id', { length: 36 })
      .notNull()
      .references(() => employerEnquiries.id),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    source: mysqlEnum('source', candidateSourceEnum).notNull(),
    status: mysqlEnum('status', candidateStatusEnum).notNull(),
    interviewAt: datetime('interview_at'),
    // Shown to the employer: interview arrangements, a call link, what happens next.
    messageToEmployer: varchar('message_to_employer', { length: 1000 }),
    // What the employer wrote when asking for an interview or stepping back. Shown to staff.
    employerMessage: varchar('employer_message', { length: 1000 }),
    // Internal: never shown to the employer or the caregiver.
    staffNote: varchar('staff_note', { length: 1000 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    oncePerEnquiry: uniqueIndex('enquiry_candidates_enquiry_caregiver_unique').on(table.enquiryId, table.caregiverId),
    caregiverIdx: index('enquiry_candidates_caregiver_idx').on(table.caregiverId),
    statusIdx: index('enquiry_candidates_status_idx').on(table.status),
  }),
);

/** Shared profiles an employer saved to come back to. */
export const employerShortlist = mysqlTable(
  'employer_shortlist',
  {
    employerId: varchar('employer_id', { length: 36 })
      .notNull()
      .references(() => employers.id),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.employerId, table.caregiverId] }),
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
