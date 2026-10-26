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
