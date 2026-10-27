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

// APPLICATION: the caregiver applied to one of the employer's vacancies and staff put them forward.
export const candidateSourceEnum = ['STAFF', 'EMPLOYER', 'APPLICATION'] as const;
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

// --- vacancy board ----------------------------------------------------------------

export const englishLevelEnum = ['BASIC', 'CONVERSATIONAL', 'FLUENT'] as const;
export const salaryPeriodEnum = ['HOUR', 'MONTH', 'YEAR'] as const;

/**
 * PENDING_REVIEW: posted by an employer, waiting for staff. PUBLISHED: on the
 * public board. REJECTED: staff sent it back (note says why). CLOSED: no
 * longer taking applications. FILLED: every role has been placed.
 */
export const vacancyStatusEnum = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSED', 'FILLED'] as const;
export type VacancyStatus = (typeof vacancyStatusEnum)[number];

/**
 * A job abroad, on the public vacancy board. Every vacancy hangs off an
 * employer enquiry, so applicants staff put forward land on that enquiry as
 * candidates and follow the same path to interview and placement.
 *
 * The board never names the employer: caregivers see the kind of employer,
 * the country and the terms. Introductions still go through staff.
 */
export const overseasVacancies = mysqlTable(
  'overseas_vacancies',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // "VC-7K2Q9M": short enough to read out on the phone.
    reference: varchar('reference', { length: 16 }).notNull().unique(),
    enquiryId: varchar('enquiry_id', { length: 36 })
      .notNull()
      .references(() => employerEnquiries.id),
    employerId: varchar('employer_id', { length: 36 }).references(() => employers.id),
    title: varchar('title', { length: 150 }).notNull(),
    country: varchar('country', { length: 2 }).notNull(),
    city: varchar('city', { length: 100 }),
    careSetting: varchar('care_setting', { length: 40 }).notNull(),
    rolesCount: int('roles_count').notNull(),
    description: text('description').notNull(),
    requirements: text('requirements'),
    minExperienceYears: int('min_experience_years').notNull().default(0),
    englishLevel: mysqlEnum('english_level', englishLevelEnum).notNull().default('CONVERSATIONAL'),
    salaryMin: decimal('salary_min', { precision: 12, scale: 2, mode: 'number' }),
    salaryMax: decimal('salary_max', { precision: 12, scale: 2, mode: 'number' }),
    salaryCurrency: varchar('salary_currency', { length: 3 }),
    salaryPeriod: mysqlEnum('salary_period', salaryPeriodEnum),
    contractMonths: int('contract_months'),
    accommodationProvided: boolean('accommodation_provided'),
    visaSponsorship: mysqlEnum('visa_sponsorship', visaSponsorshipEnum).notNull().default('UNSURE'),
    startTimeframe: varchar('start_timeframe', { length: 100 }),
    // Last day applications are taken. Null = until staff close it.
    closesOn: date('closes_on', { mode: 'string' }),
    status: mysqlEnum('status', vacancyStatusEnum).notNull().default('PENDING_REVIEW'),
    reviewNote: varchar('review_note', { length: 500 }),
    reviewedByUserId: varchar('reviewed_by_user_id', { length: 36 }),
    reviewedAt: datetime('reviewed_at'),
    publishedAt: datetime('published_at'),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('overseas_vacancies_status_idx').on(table.status, table.publishedAt),
    employerIdx: index('overseas_vacancies_employer_idx').on(table.employerId),
    enquiryIdx: index('overseas_vacancies_enquiry_idx').on(table.enquiryId),
  }),
);

/**
 * APPLIED: waiting for staff. PUT_FORWARD: staff made the caregiver a
 * candidate on the vacancy's enquiry (candidateId). NOT_SUCCESSFUL: staff
 * decided not to put them forward. WITHDRAWN: the caregiver stepped back.
 */
export const vacancyApplicationStatusEnum = ['APPLIED', 'PUT_FORWARD', 'NOT_SUCCESSFUL', 'WITHDRAWN'] as const;
export type VacancyApplicationStatus = (typeof vacancyApplicationStatusEnum)[number];

export const vacancyApplications = mysqlTable(
  'vacancy_applications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    vacancyId: varchar('vacancy_id', { length: 36 })
      .notNull()
      .references(() => overseasVacancies.id),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    status: mysqlEnum('status', vacancyApplicationStatusEnum).notNull().default('APPLIED'),
    // The caregiver's note to staff. Never sent to the employer as written.
    message: varchar('message', { length: 1000 }),
    candidateId: varchar('candidate_id', { length: 36 }).references(() => enquiryCandidates.id),
    // Internal: never shown to the caregiver.
    staffNote: varchar('staff_note', { length: 1000 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    oncePerVacancy: uniqueIndex('vacancy_applications_vacancy_caregiver_unique').on(table.vacancyId, table.caregiverId),
    caregiverIdx: index('vacancy_applications_caregiver_idx').on(table.caregiverId),
    statusIdx: index('vacancy_applications_status_idx').on(table.status, table.createdAt),
  }),
);

// --- placements ----------------------------------------------------------------------

/**
 * PRE_DEPARTURE: hired, preparing to travel. DEPLOYED: arrived and working.
 * COMPLETED: the contract ran its course. ENDED_EARLY: it stopped before the
 * contract end (endReason says why).
 */
export const placementStatusEnum = ['PRE_DEPARTURE', 'DEPLOYED', 'COMPLETED', 'ENDED_EARLY'] as const;
export type PlacementStatus = (typeof placementStatusEnum)[number];

/**
 * A caregiver hired through the platform, from the moment staff mark the
 * candidate Placed until the contract ends. Staff check on the caregiver at
 * set points after arrival (placement_checkins); the employer is invoiced
 * the placement fee (placement_invoices).
 */
export const placements = mysqlTable(
  'placements',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    candidateId: varchar('candidate_id', { length: 36 })
      .notNull()
      .unique()
      .references(() => enquiryCandidates.id),
    enquiryId: varchar('enquiry_id', { length: 36 })
      .notNull()
      .references(() => employerEnquiries.id),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    employerId: varchar('employer_id', { length: 36 }).references(() => employers.id),
    country: varchar('country', { length: 2 }).notNull(),
    jobTitle: varchar('job_title', { length: 150 }),
    status: mysqlEnum('status', placementStatusEnum).notNull().default('PRE_DEPARTURE'),
    departureOn: date('departure_on', { mode: 'string' }),
    arrivedOn: date('arrived_on', { mode: 'string' }),
    contractStartOn: date('contract_start_on', { mode: 'string' }),
    contractMonths: int('contract_months'),
    endedOn: date('ended_on', { mode: 'string' }),
    endReason: varchar('end_reason', { length: 500 }),
    // If the placement ends within this many months of the contract start,
    // the employer is offered a replacement without a second fee.
    guaranteeMonths: int('guarantee_months').notNull().default(3),
    feeAmount: decimal('fee_amount', { precision: 12, scale: 2, mode: 'number' }),
    feeCurrency: varchar('fee_currency', { length: 3 }),
    // Internal: never shown to the employer or the caregiver.
    staffNote: text('staff_note'),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('placements_status_idx').on(table.status),
    caregiverIdx: index('placements_caregiver_idx').on(table.caregiverId),
    employerIdx: index('placements_employer_idx').on(table.employerId),
    enquiryIdx: index('placements_enquiry_idx').on(table.enquiryId),
  }),
);

export const checkinKindEnum = ['ARRIVAL', 'DAY_30', 'DAY_90', 'DAY_180'] as const;
export type CheckinKind = (typeof checkinKindEnum)[number];

export const checkinOutcomeEnum = ['WELL', 'CONCERN', 'URGENT'] as const;
export type CheckinOutcome = (typeof checkinOutcomeEnum)[number];

/** A welfare call staff make to a placed caregiver, due a set time after arrival. */
export const placementCheckins = mysqlTable(
  'placement_checkins',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    placementId: varchar('placement_id', { length: 36 })
      .notNull()
      .references(() => placements.id),
    kind: mysqlEnum('kind', checkinKindEnum).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    completedOn: date('completed_on', { mode: 'string' }),
    outcome: mysqlEnum('outcome', checkinOutcomeEnum),
    note: varchar('note', { length: 1000 }),
    recordedByUserId: varchar('recorded_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    oncePerKind: uniqueIndex('placement_checkins_placement_kind_unique').on(table.placementId, table.kind),
    dueIdx: index('placement_checkins_due_idx').on(table.completedOn, table.dueOn),
  }),
);

// --- placement fee invoices -------------------------------------------------------------

/**
 * The employer's placement fee, invoiced in the employer's currency. Kept
 * apart from client invoices (billing.schema.ts), which are always to a local
 * client, in rupees, for care.
 *
 * DRAFT: staff are preparing it; no number, the employer cannot see it.
 * ISSUED: numbered and sent. PAID: payments cover the amount. VOID: cancelled
 * (only with nothing paid); the number stays used.
 */
export const placementInvoiceStatusEnum = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export type PlacementInvoiceStatus = (typeof placementInvoiceStatusEnum)[number];

export const placementInvoices = mysqlTable(
  'placement_invoices',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // "PF-2026-0007", set on issue.
    number: varchar('number', { length: 24 }).unique(),
    enquiryId: varchar('enquiry_id', { length: 36 })
      .notNull()
      .references(() => employerEnquiries.id),
    placementId: varchar('placement_id', { length: 36 }).references(() => placements.id),
    employerId: varchar('employer_id', { length: 36 }).references(() => employers.id),
    status: mysqlEnum('status', placementInvoiceStatusEnum).notNull().default('DRAFT'),
    currency: varchar('currency', { length: 3 }).notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    amountPaid: decimal('amount_paid', { precision: 12, scale: 2 }).notNull().default('0.00'),
    description: varchar('description', { length: 300 }).notNull(),
    billToName: varchar('bill_to_name', { length: 200 }).notNull(),
    billToEmail: varchar('bill_to_email', { length: 255 }),
    billToAddress: varchar('bill_to_address', { length: 500 }),
    billToCountry: varchar('bill_to_country', { length: 2 }),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    // Who it is from, frozen on issue (see invoices.seller_snapshot).
    sellerSnapshot: text('seller_snapshot'),
    footer: text('footer'),
    // Printed on the invoice, for the employer.
    notes: text('notes'),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    issuedAt: datetime('issued_at'),
    paidAt: datetime('paid_at'),
    voidedAt: datetime('voided_at'),
    voidReason: varchar('void_reason', { length: 500 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('placement_invoices_status_idx').on(table.status, table.dueDate),
    employerIdx: index('placement_invoices_employer_idx').on(table.employerId),
    placementIdx: index('placement_invoices_placement_idx').on(table.placementId),
    enquiryIdx: index('placement_invoices_enquiry_idx').on(table.enquiryId),
  }),
);

/** Issued placement invoices are numbered without gaps, per calendar year. */
export const placementInvoiceCounters = mysqlTable('placement_invoice_counters', {
  year: int('year').primaryKey(),
  lastNumber: int('last_number').notNull().default(0),
});

export const placementPaymentMethodEnum = ['BANK_TRANSFER', 'CARD_ONLINE', 'OTHER'] as const;
export type PlacementPaymentMethod = (typeof placementPaymentMethodEnum)[number];

/**
 * Money against a placement invoice: a payment (positive) or a refund
 * (negative). Online card payments carry PayHere's payment id, unique, so a
 * repeated notification is counted once.
 */
export const placementInvoicePayments = mysqlTable(
  'placement_invoice_payments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => placementInvoices.id),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    method: mysqlEnum('method', placementPaymentMethodEnum).notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    reference: varchar('reference', { length: 120 }),
    note: varchar('note', { length: 500 }),
    externalId: varchar('external_id', { length: 80 }).unique(),
    recordedByUserId: varchar('recorded_by_user_id', { length: 36 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    invoiceIdx: index('placement_invoice_payments_invoice_idx').on(table.invoiceId),
  }),
);

export const placementCheckoutStatusEnum = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'CHARGEDBACK'] as const;

/** One attempt to pay a placement invoice online; its id is PayHere's order_id. */
export const placementCheckouts = mysqlTable(
  'placement_checkouts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    invoiceId: varchar('invoice_id', { length: 36 })
      .notNull()
      .references(() => placementInvoices.id),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    mode: mysqlEnum('mode', ['SANDBOX', 'LIVE']).notNull(),
    status: mysqlEnum('status', placementCheckoutStatusEnum).notNull().default('PENDING'),
    paymentId: varchar('payment_id', { length: 64 }),
    method: varchar('method', { length: 20 }),
    statusMessage: varchar('status_message', { length: 255 }),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    invoiceIdx: index('placement_checkouts_invoice_idx').on(table.invoiceId),
  }),
);

// --- document expiry reminders ----------------------------------------------------------

export const expiryReminderStageEnum = ['DAYS_90', 'DAYS_30', 'EXPIRED'] as const;
export type ExpiryReminderStage = (typeof expiryReminderStageEnum)[number];

/**
 * Which expiry reminders have gone out, so each is sent once. Keyed on the
 * expiry date as well: a renewed passport (new date) starts a fresh cycle.
 * subject is 'PASSPORT' or 'DOC:<caregiver_documents.id>'.
 */
export const documentExpiryReminders = mysqlTable(
  'document_expiry_reminders',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 })
      .notNull()
      .references(() => caregivers.id),
    subject: varchar('subject', { length: 60 }).notNull(),
    expiresOn: date('expires_on', { mode: 'string' }).notNull(),
    stage: mysqlEnum('stage', expiryReminderStageEnum).notNull(),
    sentAt: datetime('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    once: uniqueIndex('document_expiry_reminders_unique').on(table.caregiverId, table.subject, table.expiresOn, table.stage),
  }),
);
