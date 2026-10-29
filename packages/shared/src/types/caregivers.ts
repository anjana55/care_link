import type { CareType } from './care-types';

/**
 * A caregiver's own record, as the signed-in caregiver sees it: profile,
 * documents, availability, qualifications and experience. Used by the public
 * site's caregiver area and the mobile app.
 *
 * The value lists are the database's own. apps/api's schema imports them
 * (as genderEnum, caregiverStatusEnum and so on) instead of declaring copies,
 * so a value added there is a value every client knows about - the same rule
 * care-plans.ts follows.
 */

export const genderValues = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof genderValues)[number];

export const civilStatusValues = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'] as const;
export type CivilStatus = (typeof civilStatusValues)[number];

/**
 * How a person wants to be reached first - caregivers and clients alike.
 * EMAIL is only valid for an account that has an email address.
 */
export const contactMethodValues = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
export type ContactMethod = (typeof contactMethodValues)[number];

export const caregiverStatusValues = [
  'DRAFT',
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'UNDER_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;
export type CaregiverStatus = (typeof caregiverStatusValues)[number];

/** For documents, qualifications and experience alike. */
export const verificationStatusValues = ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof verificationStatusValues)[number];

/**
 * Every type the database accepts. The caregiver's own upload picker offers
 * fewer (identity, police clearance, Grama Niladhari certificate, other) -
 * the rest are added by staff.
 */
export const documentTypeValues = [
  'NIC',
  'PASSPORT',
  'GRAMA_NILADHARI_CERTIFICATE',
  'POLICE_CLEARANCE',
  'CAREGIVER_CERTIFICATE',
  'NVQ_CERTIFICATE',
  'NURSING_CERTIFICATE',
  'CV',
  'OTHER',
] as const;
export type DocumentType = (typeof documentTypeValues)[number];

export const shiftPreferenceValues = ['DAY', 'NIGHT', 'TWENTY_FOUR_HOUR_LIVE_IN', 'FLEXIBLE'] as const;
export type ShiftPreference = (typeof shiftPreferenceValues)[number];

export const qualificationTypeValues = [
  'NVQ',
  'NURSING_DIPLOMA',
  'NURSING_DEGREE',
  'CAREGIVER_CERTIFICATE',
  'FIRST_AID',
  'OTHER',
] as const;
export type QualificationType = (typeof qualificationTypeValues)[number];

/** GET /caregivers/:id/profile for the caregiver themselves. */
export interface OwnCaregiver {
  id: string;
  registrationNumber: string;
  status: CaregiverStatus;
  fullName: string;
  permanentAddress: string;
  nic: string | null;
  passportNumber: string | null;
  dateOfBirth: string;
  gender: Gender;
  civilStatus: CivilStatus;
  heightIn: string | number | null;
  weightKg: string | number | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
  policeDivision: string | null;
  policeStation: string | null;
  preferredContactMethod: ContactMethod | null;
  districtId: number | null;
  cityId: number | null;
  skills: { skillId: string; name: string }[];
  languages: { languageId: string; name: string }[];
  documents: { id: string; documentType: string; verificationStatus: VerificationStatus }[];
}

export interface CaregiverDocument {
  id: string;
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  /** YYYY-MM-DD, when the document stops being valid. */
  expiresOn: string | null;
  createdAt: string;
}

export interface Availability {
  id: string;
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  availableFrom: string | null;
  preferredShift: ShiftPreference;
  expectedDailyRate: string | null;
  expectedMonthlyRate: string | null;
  expectedLeaveDays: number | null;
  preferredLeavePattern: string | null;
  /** The kinds of care they take on; families searching for another kind will not see them. */
  careTypes?: CareType[];
}

export interface Qualification {
  id: string;
  name: string;
  type: QualificationType;
  institution: string;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  verificationStatus: VerificationStatus;
}

export interface Experience {
  id: string;
  employerOrClient: string;
  role: string;
  location: string | null;
  country: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
  verificationStatus: VerificationStatus;
}

/** A skill or a language, as the reference lists return them. */
export interface NamedItem {
  id: string;
  name: string;
}
