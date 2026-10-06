/** Shapes returned by the API for a signed-in caregiver's own record. */

export type CaregiverStatus =
  | 'DRAFT' | 'REGISTERED' | 'DOCUMENTS_PENDING' | 'UNDER_VERIFICATION'
  | 'VERIFIED' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED';

export type VerificationStatus = 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED';

export interface OwnCaregiver {
  id: string;
  registrationNumber: string;
  status: CaregiverStatus;
  fullName: string;
  permanentAddress: string;
  nic: string | null;
  passportNumber: string | null;
  dateOfBirth: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  civilStatus: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | 'OTHER';
  heightIn: string | number | null;
  weightKg: string | number | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
  policeDivision: string | null;
  policeStation: string | null;
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
  createdAt: string;
}

export const DOCUMENT_TYPES = [
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
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SHIFT_PREFERENCES = ['DAY', 'NIGHT', 'TWENTY_FOUR_HOUR_LIVE_IN', 'FLEXIBLE'] as const;
export type ShiftPreference = (typeof SHIFT_PREFERENCES)[number];

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
}

export const QUALIFICATION_TYPES = ['NVQ', 'NURSING_DIPLOMA', 'NURSING_DEGREE', 'CAREGIVER_CERTIFICATE', 'FIRST_AID', 'OTHER'] as const;

export interface Qualification {
  id: string;
  name: string;
  type: (typeof QUALIFICATION_TYPES)[number];
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

export interface NamedItem { id: string; name: string }
