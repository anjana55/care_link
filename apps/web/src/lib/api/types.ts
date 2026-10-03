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

/** Client status ladder - mirrors clientStatusEnum on the API. */
export type ClientStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

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
  /** City ids. The API matches on the caregiver's own city or on one of their
   *  preferred work cities. */
  locationIds?: number[];
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
  heightIn: number | null;
  weightKg: number | null;
  primaryPhone: string;
  secondaryPhone: string | null;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
  policeDivision: string | null;
  policeStation: string | null;
  status: CaregiverStatus;
  /** Ids are the source of truth and what the edit form round-trips; the names
   *  and postcode beside them are derived server-side display caches. */
  districtId: number | null;
  cityId: number | null;
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

/**
 * A province -> district node of the locations reference data. Names are
 * already resolved to the caller's language by the API, so there is one `name`
 * rather than a column per locale. The whole tree is 34 rows and worth caching;
 * the 2155 cities underneath it are fetched per district.
 */
export interface LocationProvince {
  id: number;
  name: string;
  districts: LocationDistrict[];
}

export interface LocationDistrict {
  id: number;
  name: string;
}

export interface LocationCity {
  id: number;
  name: string;
  subName: string | null;
  /** A string, not a number: 47 of the real postcodes begin with 0. */
  postcode: string | null;
  latitude: number;
  longitude: number;
}

/** The same city as the read-only browse page returns it, with the parent
 *  names resolved so a result row can show its district without a second
 *  request per row. */
export interface BrowsableCity extends LocationCity {
  districtId: number;
  district: string;
  province: string;
}

/** One page of the staff browse page, plus the total for its pager. */
export interface PagedCities {
  items: BrowsableCity[];
  total: number;
  page: number;
  pageSize: number;
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

export type StaffRole = 'ADMIN' | 'STAFF' | 'VERIFIER';

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public, secret-free view of WhatsApp sign-in availability (GET /auth/whatsapp/config). */
export interface WhatsappPublicConfig {
  enabled: boolean;
  caregiver: { register: boolean; login: boolean; recovery: boolean };
  customer: { register: boolean; login: boolean; recovery: boolean };
  otpLength: number;
  otpTtlSeconds: number;
  resendCooldownSeconds: number;
  defaultCountryCode: string;
}

export type WhatsappOtpPurpose = 'REGISTER' | 'LOGIN' | 'RECOVERY';

/** Admin-managed WhatsApp settings (GET/PATCH /settings/whatsapp). The access token is never returned. */
export interface WhatsappSettings {
  enabled: boolean;
  caregiverEnabled: boolean;
  customerEnabled: boolean;
  registrationEnabled: boolean;
  loginEnabled: boolean;
  recoveryEnabled: boolean;
  provider: 'META_CLOUD' | 'CONSOLE';
  apiBaseUrl: string;
  apiVersion: string;
  phoneNumberId: string | null;
  businessAccountId: string | null;
  accessTokenSet: boolean;
  accessTokenHint: string | null;
  templateName: string;
  templateLanguage: string;
  templateHasCopyCodeButton: boolean;
  otpLength: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxSendsPerHour: number;
  defaultCountryCode: string;
  updatedAt: string;
}

/**
 * A registered patient/guardian, as returned by the staff clients endpoints.
 *
 * `phone` is masked on the list endpoint and raw on the detail endpoint (the
 * same split the caregiver list uses). `email` is null for a WhatsApp-only
 * client, who never supplied one.
 */
export interface Client {
  id: string;
  userId: string;
  fullName: string;
  phone: string | null;
  status: ClientStatus;
  consentAcceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  email: string | null;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

export interface ClientListResponse {
  items: Client[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
