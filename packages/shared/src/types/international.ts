/**
 * The international paths: overseas employers looking for caregivers from
 * Sri Lanka, and local caregivers preparing for work abroad.
 *
 * Employers never get an account or a caregiver's contact details: they send
 * an enquiry and staff make every introduction. Revenue on this path is a
 * placement fee the employer pays once a caregiver starts work - caregivers
 * are never charged for a placement.
 */

import type { CareType } from './care-types';
import type { Locale } from './locale';
import type { BillingParty } from './billing';

// --- countries -------------------------------------------------------------

/**
 * ISO 3166-1 alpha-2 codes. Names are not stored: the browser's
 * Intl.DisplayNames renders them in the visitor's language (Sinhala and Tamil
 * included), so the list never needs translating by hand.
 */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ',
  'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU',
  'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FR', 'GA',
  'GB', 'GD', 'GE', 'GH', 'GM', 'GN', 'GQ', 'GR', 'GT', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN',
  'IQ', 'IR', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MR',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE', 'PG',
  'PH', 'PK', 'PL', 'PS', 'PT', 'PW', 'PY', 'QA', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SI', 'SK',
  'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SY', 'SZ', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT',
  'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VN', 'VU', 'WS', 'XK', 'YE', 'ZA', 'ZM', 'ZW',
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && (COUNTRY_CODES as readonly string[]).includes(value);
}

/** How many destinations a caregiver may list. */
export const MAX_TARGET_COUNTRIES = 5;

// --- employer enquiries ----------------------------------------------------

export const employerTypeValues = ['RECRUITMENT_AGENCY', 'CARE_HOME', 'HOSPITAL', 'HOME_CARE_PROVIDER', 'PRIVATE_FAMILY', 'OTHER'] as const;
export type EmployerType = (typeof employerTypeValues)[number];

export const visaSponsorshipValues = ['YES', 'NO', 'UNSURE'] as const;
export type VisaSponsorship = (typeof visaSponsorshipValues)[number];

export const employerEnquiryStatusValues = ['NEW', 'IN_PROGRESS', 'INTRODUCED', 'PLACED', 'CLOSED'] as const;
export type EmployerEnquiryStatus = (typeof employerEnquiryStatusValues)[number];

/** POST /public/international/enquiries */
export interface EmployerEnquiryRequest {
  organisationName: string;
  organisationType: EmployerType;
  country: CountryCode;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  rolesCount: number;
  careSettings: CareType[];
  languages?: string;
  startTimeframe?: string;
  visaSponsorship: VisaSponsorship;
  message?: string;
  /** Present when the enquiry was sent from a shared profile. */
  talentSlug?: string;
  consent: true;
  language?: Locale;
  /** Honeypot: real visitors never see or fill it. */
  website2?: string;
}

export interface EmployerEnquiryReceipt {
  reference: string;
}

/** Staff view of one enquiry. */
export interface EmployerEnquiry {
  id: string;
  reference: string;
  organisationName: string;
  organisationType: EmployerType;
  country: string;
  contactName: string;
  email: string;
  phone: string | null;
  website: string | null;
  rolesCount: number;
  careSettings: string[];
  languages: string | null;
  startTimeframe: string | null;
  visaSponsorship: VisaSponsorship;
  message: string | null;
  caregiver: { id: string; registrationNumber: string; fullName: string; talentSlug: string | null } | null;
  /** The employer account that sent it (or that staff linked it to). */
  employer: { id: string; organisationName: string; status: EmployerStatus } | null;
  status: EmployerEnquiryStatus;
  staffNote: string | null;
  placementFeeAmount: number | null;
  placementFeeCurrency: string | null;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployerEnquiryList {
  items: EmployerEnquiry[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EmployerEnquirySummary {
  new: number;
  open: number;
}

/** The staff Overseas badge: everything waiting for someone in the office. */
export interface OverseasStaffSummary extends EmployerEnquirySummary {
  pendingProfiles: number;
  pendingEmployers: number;
  interviewRequests: number;
  /** Vacancies employers posted that staff have not reviewed yet. */
  pendingVacancies: number;
  /** Applications to vacancies that staff have not acted on yet. */
  newApplications: number;
  /** Welfare check-ins past their due date. */
  overdueCheckins: number;
  /** Issued placement invoices past their due date and not paid. */
  overdueInvoices: number;
}

/** Numbers for the employer landing page. Counts only. */
export interface InternationalSummary {
  /** Listed caregivers who have said they are open to working abroad. */
  openToOverseas: number;
  /** Of those, how many have a live shared profile. */
  sharedProfiles: number;
  /** Training completions recorded by staff. */
  trainingCompletions: number;
}

// --- overseas readiness ----------------------------------------------------

export interface OverseasReadiness {
  openToOverseas: boolean;
  targetCountries: CountryCode[];
  passportHeld: boolean | null;
  /** YYYY-MM-DD */
  passportExpiry: string | null;
  /** YYYY-MM-DD */
  availableFrom: string | null;
}

// --- training --------------------------------------------------------------

export const trainingCategoryValues = ['ENGLISH', 'CAREGIVING', 'OTHER'] as const;
export type TrainingCategory = (typeof trainingCategoryValues)[number];

export const trainingFormatValues = ['IN_PERSON', 'ONLINE', 'BLENDED'] as const;
export type TrainingFormat = (typeof trainingFormatValues)[number];

export const trainingEnrolmentStatusValues = ['INTERESTED', 'ENROLLED', 'COMPLETED', 'WITHDRAWN'] as const;
export type TrainingEnrolmentStatus = (typeof trainingEnrolmentStatusValues)[number];

/** A programme as the public site and caregivers see it, in one language. */
export interface PublicTrainingProgramme {
  id: string;
  category: TrainingCategory;
  format: TrainingFormat;
  title: string;
  description: string;
  duration: string | null;
  feeLkr: number | null;
  nextStartDate: string | null;
}

/** The staff edit form: every language. */
export interface TrainingProgramme {
  id: string;
  category: TrainingCategory;
  format: TrainingFormat;
  titleEn: string;
  titleSi: string | null;
  titleTa: string | null;
  descriptionEn: string;
  descriptionSi: string | null;
  descriptionTa: string | null;
  duration: string | null;
  feeLkr: number | null;
  nextStartDate: string | null;
  isActive: boolean;
  sortOrder: number;
  /** Not counting withdrawn. */
  enrolmentCount: number;
}

export type TrainingProgrammeInput = Omit<TrainingProgramme, 'id' | 'enrolmentCount'>;

export interface CaregiverTrainingEnrolment {
  id: string;
  programmeId: string;
  status: TrainingEnrolmentStatus;
  completedAt: string | null;
}

/** Staff list of who has signed up for a programme. */
export interface TrainingEnrolmentRow {
  id: string;
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  status: TrainingEnrolmentStatus;
  completedAt: string | null;
  staffNote: string | null;
  createdAt: string;
}

// --- shared profiles -------------------------------------------------------

export const sharedProfileStatusValues = ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type SharedProfileStatus = (typeof sharedProfileStatusValues)[number];

/**
 * Bumped whenever the consent wording changes, so each caregiver's record
 * says which text they agreed to. A new version does not invalidate older
 * consents by itself - that is a legal decision, made separately.
 */
export const SHARED_PROFILE_CONSENT_VERSION = '2026-10';

export const SHARED_PROFILE_LIMITS = { firstName: 60, headline: 120, bio: 1000 } as const;

/** The caregiver's own view and edit form. */
export interface SharedProfileSettings {
  slug: string | null;
  isShared: boolean;
  firstName: string;
  headline: string | null;
  bio: string | null;
  hasPhoto: boolean;
  status: SharedProfileStatus;
  reviewNote: string | null;
  consentAcceptedAt: string | null;
  consentVersion: string | null;
  /** True when the public page is showing right now. */
  isLive: boolean;
}

export interface SharedProfileUpdate {
  firstName: string;
  headline?: string | null;
  bio?: string | null;
}

/** Staff review queue row. */
export interface SharedProfileReviewItem {
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  slug: string;
  firstName: string;
  headline: string | null;
  bio: string | null;
  hasPhoto: boolean;
  status: SharedProfileStatus;
  isShared: boolean;
  reviewNote: string | null;
  consentAcceptedAt: string | null;
  updatedAt: string;
}

/**
 * What the public talent page shows. An explicit allow-list: first name and
 * photo (the caregiver consented to those), plus what anonymous search
 * already shows. Never a surname, NIC, passport, phone, email, address,
 * health information or references.
 */
export interface PublicTalentProfile {
  slug: string;
  firstName: string;
  headline: string | null;
  bio: string | null;
  /** Relative URL, or null when there is no photo. */
  photoUrl: string | null;
  approxAge: number;
  yearsExperience: number;
  verified: boolean;
  hasVerifiedQualification: boolean;
  careTypes: CareType[];
  languages: { name: string; proficiency: string | null }[];
  skills: string[];
  qualifications: string[];
  /** Platform training the caregiver has completed, by title in the visitor's language. */
  completedTraining: string[];
  targetCountries: string[];
  availableFrom: string | null;
}

export type PublicTalentCard = Pick<
  PublicTalentProfile,
  'slug' | 'firstName' | 'headline' | 'photoUrl' | 'yearsExperience' | 'verified' | 'languages' | 'completedTraining' | 'targetCountries'
>;

export interface PublicTalentList {
  items: PublicTalentCard[];
  page: number;
  pageSize: number;
  total: number;
}

// --- employer accounts -------------------------------------------------------

export const employerStatusValues = ['PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'] as const;
export type EmployerStatus = (typeof employerStatusValues)[number];

/** POST /auth/register-employer */
export interface EmployerRegistrationRequest {
  email: string;
  password: string;
  contactName: string;
  organisationName: string;
  organisationType: EmployerType;
  country: CountryCode;
  phone?: string;
  website?: string;
  companyRegistrationNumber?: string;
  consent: true;
}

/** The employer's own account, as they see it. */
export interface EmployerAccount {
  id: string;
  email: string | null;
  organisationName: string;
  organisationType: EmployerType;
  country: string;
  contactName: string;
  phone: string | null;
  website: string | null;
  companyRegistrationNumber: string | null;
  status: EmployerStatus;
  reviewNote: string | null;
  /** Organisation name, type and country are fixed once staff have verified them. */
  canEditOrganisation: boolean;
}

export type EmployerAccountUpdate = Partial<
  Pick<EmployerAccount, 'organisationName' | 'organisationType' | 'country' | 'contactName' | 'phone' | 'website' | 'companyRegistrationNumber'>
>;

/** Staff list of employer accounts. */
export interface EmployerAdminRow {
  id: string;
  email: string | null;
  organisationName: string;
  organisationType: EmployerType;
  country: string;
  contactName: string;
  phone: string | null;
  website: string | null;
  companyRegistrationNumber: string | null;
  status: EmployerStatus;
  reviewNote: string | null;
  emailVerified: boolean;
  enquiryCount: number;
  createdAt: string;
}

// --- candidates ----------------------------------------------------------------

export const candidateSourceValues = ['STAFF', 'EMPLOYER', 'APPLICATION'] as const;
export type CandidateSource = (typeof candidateSourceValues)[number];

export const candidateStatusValues = ['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', 'SELECTED', 'PLACED', 'NOT_PROCEEDING'] as const;
export type CandidateStatus = (typeof candidateStatusValues)[number];

/** A candidate as the employer sees them - only through the caregiver's shared profile. */
export interface EmployerCandidate {
  id: string;
  status: CandidateStatus;
  interviewAt: string | null;
  messageToEmployer: string | null;
  /** Null once the caregiver stops sharing their profile: they are no longer shown. */
  talent: PublicTalentCard | null;
}

/** One of the employer's own enquiries, with the caregivers on it. */
export interface EmployerOwnEnquiry {
  id: string;
  reference: string;
  status: EmployerEnquiryStatus;
  country: string;
  rolesCount: number;
  careSettings: string[];
  createdAt: string;
  candidates: EmployerCandidate[];
}

/** POST /employer/enquiries - a signed-in employer's enquiry; organisation details come from the account. */
export interface EmployerAccountEnquiryRequest {
  country?: CountryCode;
  rolesCount: number;
  careSettings: CareType[];
  languages?: string;
  startTimeframe?: string;
  visaSponsorship: VisaSponsorship;
  message?: string;
  talentSlug?: string;
}

/** POST /employer/candidates - "I'd like to interview her". */
export interface InterviewRequest {
  enquiryId: string;
  talentSlug: string;
  message?: string;
}

/** A candidate as staff see them. */
export interface StaffCandidate {
  id: string;
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  talentSlug: string | null;
  /** Whether the shared profile is live right now (what the employer can see). */
  profileLive: boolean;
  source: CandidateSource;
  status: CandidateStatus;
  interviewAt: string | null;
  messageToEmployer: string | null;
  employerMessage: string | null;
  staffNote: string | null;
  /** Set once staff marked them Placed: the placement that tracks them. */
  placementId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row in the staff Interview requests list, across enquiries. */
export interface StaffCandidateWithEnquiry extends StaffCandidate {
  enquiry: { id: string; reference: string; organisationName: string; country: string };
}

/** What a caregiver is told about employer interest - never the employer's name or details. */
export interface CaregiverEmployerInterest {
  id: string;
  country: string;
  organisationType: EmployerType;
  status: CandidateStatus;
  interviewAt: string | null;
  createdAt: string;
}

// --- readiness -------------------------------------------------------------------

/**
 * Ready to work abroad, in general - not tied to any one country yet.
 * Each item is checked from data staff already verify.
 */
export const readinessItemValues = [
  'registrationVerified',
  'openToOverseas',
  'passportValid',
  'policeClearance',
  'english',
  'caregiving',
  'sharedProfile',
] as const;
export type ReadinessItem = (typeof readinessItemValues)[number];

/** A passport must be valid at least this long after the caregiver could start. */
export const PASSPORT_MIN_VALIDITY_MONTHS = 6;

export interface ReadinessReport {
  items: { key: ReadinessItem; done: boolean }[];
  done: number;
  total: number;
}

/** A caregiver in the staff talent pool. */
export interface TalentPoolRow {
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  city: string | null;
  targetCountries: string[];
  availableFrom: string | null;
  talentSlug: string | null;
  profileLive: boolean;
  readiness: ReadinessReport;
}

// --- vacancy board ---------------------------------------------------------------

export const englishLevelValues = ['BASIC', 'CONVERSATIONAL', 'FLUENT'] as const;
export type EnglishLevel = (typeof englishLevelValues)[number];

export const salaryPeriodValues = ['HOUR', 'MONTH', 'YEAR'] as const;
export type SalaryPeriod = (typeof salaryPeriodValues)[number];

export const vacancyStatusValues = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSED', 'FILLED'] as const;
export type VacancyStatus = (typeof vacancyStatusValues)[number];

export const vacancyApplicationStatusValues = ['APPLIED', 'PUT_FORWARD', 'NOT_SUCCESSFUL', 'WITHDRAWN'] as const;
export type VacancyApplicationStatus = (typeof vacancyApplicationStatusValues)[number];

/** Currencies a salary or a fee may be quoted in. */
export const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'JPY', 'SGD', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'ILS', 'KRW', 'MYR', 'HKD', 'CHF', 'LKR'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Currencies PayHere can take a card payment in. Anything else is paid by bank transfer. */
export const PAYHERE_CURRENCIES = ['LKR', 'USD', 'GBP', 'EUR', 'AUD'] as const;

export const VACANCY_LIMITS = { title: 150, city: 100, description: 4000, requirements: 2000, applicationMessage: 1000 } as const;

/** What an employer (or staff) fills in to post a vacancy. */
export interface VacancyInput {
  title: string;
  country: CountryCode;
  city?: string | null;
  careSetting: CareType;
  rolesCount: number;
  description: string;
  requirements?: string | null;
  minExperienceYears: number;
  englishLevel: EnglishLevel;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: CurrencyCode | null;
  salaryPeriod?: SalaryPeriod | null;
  contractMonths?: number | null;
  accommodationProvided?: boolean | null;
  visaSponsorship: VisaSponsorship;
  startTimeframe?: string | null;
  /** YYYY-MM-DD */
  closesOn?: string | null;
}

/**
 * A vacancy on the public board. Never the employer's name: the kind of
 * employer and where. Introductions go through staff.
 */
export interface PublicVacancy {
  reference: string;
  title: string;
  organisationType: EmployerType;
  country: string;
  city: string | null;
  careSetting: string;
  rolesCount: number;
  description: string;
  requirements: string | null;
  minExperienceYears: number;
  englishLevel: EnglishLevel;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  contractMonths: number | null;
  accommodationProvided: boolean | null;
  visaSponsorship: VisaSponsorship;
  startTimeframe: string | null;
  closesOn: string | null;
  publishedAt: string;
}

export interface PublicVacancyList {
  items: PublicVacancy[];
  page: number;
  pageSize: number;
  total: number;
}

/** A vacancy as its employer, or staff, see it. */
export interface Vacancy extends Omit<PublicVacancy, 'publishedAt'> {
  id: string;
  enquiryId: string;
  enquiryReference: string;
  status: VacancyStatus;
  reviewNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Applications not withdrawn. Staff see who; the employer sees only this count. */
  applicationCount: number;
}

/** Staff only: who posted it. */
export interface StaffVacancy extends Vacancy {
  organisationName: string;
  employer: { id: string; organisationName: string; status: EmployerStatus } | null;
  newApplications: number;
}

/** POST /caregivers/:id/vacancies/:reference/apply */
export interface VacancyApplicationRequest {
  message?: string;
}

/** A caregiver's own application. */
export interface CaregiverVacancyApplication {
  id: string;
  status: VacancyApplicationStatus;
  createdAt: string;
  vacancy: Pick<PublicVacancy, 'reference' | 'title' | 'country' | 'city' | 'organisationType'> & { open: boolean };
}

/** Staff view of an application. */
export interface StaffVacancyApplication {
  id: string;
  vacancyId: string;
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  status: VacancyApplicationStatus;
  message: string | null;
  staffNote: string | null;
  candidateId: string | null;
  /** Whether the shared profile is live: only then can staff put them forward. */
  profileLive: boolean;
  readiness: ReadinessReport;
  createdAt: string;
}

// --- placements --------------------------------------------------------------------

export const placementStatusValues = ['PRE_DEPARTURE', 'DEPLOYED', 'COMPLETED', 'ENDED_EARLY'] as const;
export type PlacementStatus = (typeof placementStatusValues)[number];

export const checkinKindValues = ['ARRIVAL', 'DAY_30', 'DAY_90', 'DAY_180'] as const;
export type CheckinKind = (typeof checkinKindValues)[number];

/** Days after arrival each welfare check-in falls due. */
export const CHECKIN_DAYS_AFTER_ARRIVAL: Record<CheckinKind, number> = { ARRIVAL: 3, DAY_30: 30, DAY_90: 90, DAY_180: 180 };

export const checkinOutcomeValues = ['WELL', 'CONCERN', 'URGENT'] as const;
export type CheckinOutcome = (typeof checkinOutcomeValues)[number];

/** Months after the contract start during which an early end earns the employer a free replacement. */
export const DEFAULT_GUARANTEE_MONTHS = 3;

export interface PlacementCheckin {
  id: string;
  kind: CheckinKind;
  dueOn: string;
  completedOn: string | null;
  outcome: CheckinOutcome | null;
  note: string | null;
}

/** Staff view of a placement. */
export interface StaffPlacement {
  id: string;
  candidateId: string;
  enquiryId: string;
  enquiryReference: string;
  organisationName: string;
  employerId: string | null;
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  country: string;
  jobTitle: string | null;
  status: PlacementStatus;
  departureOn: string | null;
  arrivedOn: string | null;
  contractStartOn: string | null;
  contractMonths: number | null;
  contractEndsOn: string | null;
  endedOn: string | null;
  endReason: string | null;
  guaranteeMonths: number;
  guaranteeEndsOn: string | null;
  feeAmount: number | null;
  feeCurrency: string | null;
  staffNote: string | null;
  checkins: PlacementCheckin[];
  /** The earliest check-in not done yet. */
  nextCheckin: PlacementCheckin | null;
  invoices: PlacementInvoiceSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface PlacementUpdate {
  jobTitle?: string | null;
  status?: PlacementStatus;
  departureOn?: string | null;
  arrivedOn?: string | null;
  contractStartOn?: string | null;
  contractMonths?: number | null;
  endedOn?: string | null;
  endReason?: string | null;
  guaranteeMonths?: number;
  feeAmount?: number | null;
  feeCurrency?: string | null;
  staffNote?: string | null;
}

export interface CheckinUpdate {
  completedOn: string | null;
  outcome?: CheckinOutcome | null;
  note?: string | null;
}

/** A placement as the employer sees it: first name only, never contact details. */
export interface EmployerPlacement {
  id: string;
  enquiryReference: string;
  talent: { firstName: string; slug: string | null; photoUrl: string | null };
  country: string;
  jobTitle: string | null;
  status: PlacementStatus;
  departureOn: string | null;
  arrivedOn: string | null;
  contractStartOn: string | null;
  contractEndsOn: string | null;
  guaranteeEndsOn: string | null;
  invoices: PlacementInvoiceSummary[];
}

/** A caregiver's own placement. Never the employer's name: staff are the contact. */
export interface CaregiverPlacement {
  id: string;
  country: string;
  organisationType: EmployerType;
  jobTitle: string | null;
  status: PlacementStatus;
  departureOn: string | null;
  arrivedOn: string | null;
  contractStartOn: string | null;
  contractEndsOn: string | null;
}

// --- placement fee invoices ----------------------------------------------------------

export const placementInvoiceStatusValues = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export type PlacementInvoiceStatus = (typeof placementInvoiceStatusValues)[number];

export const placementPaymentMethodValues = ['BANK_TRANSFER', 'CARD_ONLINE', 'OTHER'] as const;
export type PlacementPaymentMethod = (typeof placementPaymentMethodValues)[number];

/** Payment terms for a placement fee, from issue. */
export const PLACEMENT_INVOICE_TERMS_DAYS = 14;

export interface PlacementInvoiceSummary {
  id: string;
  number: string | null;
  status: PlacementInvoiceStatus;
  currency: string;
  /** Decimal strings, e.g. "2500.00". */
  amount: string;
  amountPaid: string;
  balance: string;
  issueDate: string | null;
  dueDate: string | null;
  overdue: boolean;
}

export interface PlacementInvoicePayment {
  id: string;
  amount: string;
  method: PlacementPaymentMethod;
  paidOn: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

/** A whole invoice, as staff and (once issued) the employer see it. */
export interface PlacementInvoice extends PlacementInvoiceSummary {
  enquiryId: string;
  enquiryReference: string;
  placementId: string | null;
  employerId: string | null;
  description: string;
  billToName: string;
  billToEmail: string | null;
  billToAddress: string | null;
  billToCountry: string | null;
  /** Who it is from: the business details in Settings > Billing, frozen on issue. */
  seller: BillingParty;
  footer: string | null;
  notes: string | null;
  voidReason: string | null;
  payments: PlacementInvoicePayment[];
  /** Whether the employer can pay this one by card right now. */
  payOnline: boolean;
  createdAt: string;
}

/** Staff list row. */
export interface StaffPlacementInvoiceRow extends PlacementInvoiceSummary {
  enquiryReference: string;
  billToName: string;
  description: string;
}

export interface PlacementInvoiceInput {
  placementId?: string | null;
  enquiryId?: string;
  currency: CurrencyCode;
  amount: number;
  description: string;
  billToName?: string;
  billToEmail?: string | null;
  billToAddress?: string | null;
  billToCountry?: CountryCode | null;
  notes?: string | null;
}

export interface PlacementPaymentInput {
  amount: number;
  method: PlacementPaymentMethod;
  /** YYYY-MM-DD */
  paidOn: string;
  reference?: string | null;
  note?: string | null;
}

// --- documents and expiry --------------------------------------------------------------

export const expiryStateValues = ['VALID', 'EXPIRING', 'EXPIRED'] as const;
export type ExpiryState = (typeof expiryStateValues)[number];

/** A document is "expiring" this many days before it expires: when the first reminder goes out. */
export const EXPIRY_WARNING_DAYS = 90;
/** The second, closer reminder. */
export const EXPIRY_FINAL_WARNING_DAYS = 30;

/** A dated document of the caregiver's: their passport, or an upload staff gave an expiry date. */
export interface CaregiverExpiringDocument {
  /** 'PASSPORT', or the caregiver_documents id. */
  key: string;
  /** 'PASSPORT' or the upload's document type. */
  documentType: string;
  expiresOn: string;
  daysLeft: number;
  state: ExpiryState;
}

/** Staff list across caregivers. */
export interface StaffExpiringDocument extends CaregiverExpiringDocument {
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  /** In an active placement abroad: an expiring passport there is urgent. */
  placed: boolean;
}

/** What expiry state a date is in, today. */
export function expiryState(expiresOn: string, today: string): { daysLeft: number; state: ExpiryState } {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const daysLeft = Math.round((day(expiresOn) - day(today)) / 86_400_000);
  return { daysLeft, state: daysLeft < 0 ? 'EXPIRED' : daysLeft <= EXPIRY_WARNING_DAYS ? 'EXPIRING' : 'VALID' };
}
