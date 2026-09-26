export type CaregiverStatus =
  | 'DRAFT'
  | 'REGISTERED'
  | 'DOCUMENTS_PENDING'
  | 'UNDER_VERIFICATION'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'SUSPENDED'
  | 'REJECTED';

export interface CaregiverListItem {
  id: string;
  registrationNumber: string;
  fullName: string;
  nic: string | null;
  passportNumber: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
  gender: string;
  status: CaregiverStatus;
  skills: string[];
  languages: string[];
  locations: string[];
  createdAt: string;
}

export interface CaregiverSearchFilters {
  search?: string;
  status?: string;
  gender?: string;
  skillIds?: string[];
  languageIds?: string[];
  locationIds?: string[];
  dayDuty?: boolean;
  nightDuty?: boolean;
  liveIn24h?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CaregiverListResponse {
  items: CaregiverListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DashboardStats {
  totalCaregivers: number;
  pendingRegistration: number;
  awaitingVerification: number;
  verified: number;
  active: number;
  suspended: number;
  inactive: number;
  rejected: number;
  documentsRequiringAttention: number;
  byStatus: Record<string, number>;
}

export interface CaregiverDetail {
  id: string;
  registrationNumber: string;
  fullName: string;
  permanentAddress: string;
  nic: string | null;
  passportNumber: string | null;
  dateOfBirth: string;
  gender: string;
  civilStatus: string;
  heightCm: number | null;
  weightKg: number | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
  policeDivision: string | null;
  policeStation: string | null;
  status: CaregiverStatus;
  district: string | null;
  city: string | null;
  postalCode: string | null;
  createdAt: string;
  updatedAt: string;
  skills: { skillId: string; name: string; proficiency: string; yearsOfExperience: number | null }[];
  languages: { languageId: string; name: string; proficiency: string }[];
  documents: {
    id: string;
    documentType: string;
    originalFilename: string;
    verificationStatus: string;
    createdAt: string;
  }[];
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
}

export interface Language {
  id: string;
  name: string;
  code: string | null;
}

export interface Location {
  id: string;
  district: string;
  city: string;
  province: string;
}

export interface Qualification {
  id: string;
  name: string;
  type: string;
  institution: string;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  verificationStatus: string;
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
  careType: string | null;
  patientCategory: string | null;
}

export interface CaregiverHealthInfo {
  hasDiabetes: boolean;
  hasHighBloodPressure: boolean;
  physicalAbilityToLiftPatients: boolean;
  surgicalHistory: string | null;
  mentalHealthInformation: string | null;
  otherNotes: string | null;
}

export interface Availability {
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  availableFrom: string | null;
  preferredShift: string;
  expectedDailyRate: string | null;
  expectedMonthlyRate: string | null;
  expectedLeaveDays: number | null;
  preferredLeavePattern: string | null;
}
