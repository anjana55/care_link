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
  /** Care request updates over WhatsApp - independent of WhatsApp sign-in. */
  notificationsEnabled: boolean;
  notificationTemplateName: string;
  otpLength: number;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  otpMaxSendsPerHour: number;
  defaultCountryCode: string;
  updatedAt: string;
}

export type SocialProviderName = 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';

/** One provider's admin-managed OAuth settings (GET/PATCH /settings/social-auth). The secret is never returned. */
export interface SocialProviderSettings {
  id: SocialProviderName;
  provider: SocialProviderName;
  enabled: boolean;
  clientId: string | null;
  clientSecretSet: boolean;
  clientSecretHint: string | null;
  /** Microsoft only. */
  tenant: string;
  /** Facebook only. */
  apiVersion: string;
  /** The exact callback URL to register in the provider's console. */
  redirectUri: string;
  /** Enabled and complete: the provider is actually offered on the public screens. */
  usable: boolean;
  updatedAt: string | null;
}

/** Admin-managed outgoing mail server (GET/PATCH /settings/email). The password is never returned. */
export interface EmailSettings {
  /** Deliver email through this server; off = emails are only written to the API log. */
  enabled: boolean;
  host: string | null;
  port: number;
  /** true = TLS from the first byte (usually 465); false = STARTTLS (usually 587). */
  secure: boolean;
  username: string | null;
  passwordSet: boolean;
  fromName: string;
  fromAddress: string | null;
  replyTo: string | null;
  /** Comma-separated; null = every active admin and staff account. */
  requestAlertsTo: string | null;
  /** Enabled and complete: emails are actually being sent. */
  usable: boolean;
  updatedAt: string;
}

// --- Clients (self-registered patients/guardians) ---------------------------

export type RegistrantType = 'SELF' | 'GUARDIAN';
export type RecipientRelationship = 'PARENT' | 'SPOUSE' | 'CHILD' | 'SIBLING' | 'OTHER_RELATIVE' | 'FRIEND' | 'OTHER';
export type ContactMethod = 'PHONE_CALL' | 'WHATSAPP' | 'EMAIL';
export type ContactTime = 'ANYTIME' | 'MORNING' | 'AFTERNOON' | 'EVENING';
export type CareSchedule = 'DAY' | 'NIGHT' | 'LIVE_IN_24H' | 'NOT_SURE';
export type CareStart = 'IMMEDIATELY' | 'WITHIN_WEEK' | 'WITHIN_MONTH' | 'JUST_EXPLORING';
export type CaregiverGenderPreference = 'NO_PREFERENCE' | 'MALE' | 'FEMALE';

/**
 * A registered patient/guardian, as returned by the staff clients endpoints.
 *
 * `phone` is masked on the list endpoint and raw on the detail endpoint (the
 * same split the caregiver list uses). `email` is null for a WhatsApp-only
 * client, who never supplied one.
 *
 * `accountPhone` is a different number from `phone`: it is the E.164 WhatsApp
 * *login* identity on the linked account, and is null for every client who
 * registered by email. The two disagree until a staff edit reconciles them, so
 * the edit form submits `phone` and lets the API decide what the account row
 * should become - never write `accountPhone` from here.
 *
 * The staff-editable profile block (permanentAddress, nic, ...) is null on any
 * row that has not been through a staff edit, since only staff fill it in. The
 * intake block (registrantType, careNeeds, ...) is nullable for the opposite
 * reason: clients who registered before the intake form existed have none of it.
 */
export interface Client {
  id: string;
  userId: string;
  fullName: string;
  phone: string | null;
  status: ClientStatus;
  consentAcceptedAt: string | null;
  permanentAddress: string | null;
  /** ISO serialised, e.g. "1990-05-05T00:00:00.000Z". Slice to 10 chars for a date input. */
  dateOfBirth: string | null;
  gender: ClientGender | null;
  nic: string | null;
  // --- intake, captured at self-registration -----------------------------
  alternatePhone: string | null;
  preferredContactMethod: ContactMethod | null;
  preferredContactTime: ContactTime | null;
  registrantType: RegistrantType | null;
  recipientName: string | null;
  recipientRelationship: RecipientRelationship | null;
  recipientAge: number | null;
  recipientGender: ClientGender | null;
  districtId: number | null;
  cityId: number | null;
  district: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  notes: string | null;
  careAddress: string | null;
  careNeeds: string | null;
  careSchedule: CareSchedule | null;
  careStart: CareStart | null;
  preferredCaregiverGender: CaregiverGenderPreference | null;
  createdAt: string;
  updatedAt: string;
  email: string | null;
  accountPhone: string | null;
  isActive: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
}

export type ClientGender = 'MALE' | 'FEMALE' | 'OTHER';

export interface ClientListResponse {
  items: Client[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** GET /caregivers/:id/sign-in - how this caregiver can sign in, for the staff "Sign-in" tab. */
export interface CaregiverSignInMethods {
  hasAccount: boolean;
  isActive: boolean;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  hasPassword: boolean;
  providers: { provider: SocialProviderName; providerEmail: string; linkedAt: string }[];
  lastLoginAt: string | null;
  /** True while the caregiver can finish the account with their registration number. */
  claimable: boolean;
  staffClaimCodeExpiresAt: string | null;
}

export interface ResetSignInRequest {
  providers?: SocialProviderName[];
  password?: boolean;
  phone?: boolean;
  email?: boolean;
}

export interface IssuedClaimCode {
  code: string;
  expiresAt: string;
  registrationNumber: string;
  /** The public-site page where the caregiver enters the code. */
  claimUrl: string;
}

// --- care requests (staff Requests queue) ------------------------------------
/** Mirrors careRequestStatusEnum on the API. */
export type CareRequestStatus = 'NEW' | 'IN_PROGRESS' | 'INTRODUCED' | 'CLOSED' | 'CANCELLED';
/** WEB: the client pressed Contact on the site. PHONE: staff logged it during a call. */
export type CareRequestSource = 'WEB' | 'PHONE';
export type CareRequestCloseReason =
  | 'CLIENT_NOT_PROCEEDING'
  | 'CLIENT_UNREACHABLE'
  | 'CAREGIVER_UNAVAILABLE'
  | 'CAREGIVER_DECLINED'
  | 'NOT_A_MATCH'
  | 'PLACED'
  | 'OTHER';

export interface StaffRef {
  id: string;
  fullName: string;
}

export interface CareRequestListItem {
  id: string;
  reference: string;
  status: CareRequestStatus;
  createdAt: string;
  updatedAt: string;
  assignedTo: StaffRef | null;
  clientId: string;
  clientName: string;
  clientStatus: ClientStatus;
  /** Masked, like the clients list. */
  clientPhone: string | null;
  recipientName: string | null;
  registrantType: 'SELF' | 'GUARDIAN' | null;
  careStart: string | null;
  source: CareRequestSource;
  /** All null while no caregiver is attached yet. */
  caregiverId: string | null;
  caregiverName: string | null;
  caregiverRegistrationNumber: string | null;
  caregiverStatus: CaregiverStatus | null;
  caregiverDeleted: boolean;
}

export interface CareRequestListResponse {
  items: CareRequestListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CareRequestEvent {
  id: string;
  type: 'CREATED' | 'STATUS_CHANGED' | 'NOTE' | 'ASSIGNED' | 'CANCELLED' | 'CAREGIVER_CHANGED';
  fromStatus: CareRequestStatus | null;
  toStatus: CareRequestStatus | null;
  closeReason: CareRequestCloseReason | null;
  note: string | null;
  createdAt: string;
  actor: StaffRef | null;
}

export interface CareRequestDetail {
  id: string;
  reference: string;
  status: CareRequestStatus;
  message: string | null;
  language: 'en' | 'si' | 'ta';
  closeReason: CareRequestCloseReason | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo: StaffRef | null;
  source: CareRequestSource;
  /** The staff member who logged a PHONE request. */
  createdBy: StaffRef | null;
  allowedNextStatuses: CareRequestStatus[];
  /** Whether the caregiver can still be attached or swapped (NEW / IN_PROGRESS). */
  canChangeCaregiver: boolean;
  client: {
    id: string;
    fullName: string;
    status: ClientStatus;
    email: string | null;
    phone: string | null;
    accountPhone: string | null;
    alternatePhone: string | null;
    preferredContactMethod: 'PHONE_CALL' | 'WHATSAPP' | 'EMAIL' | null;
    preferredContactTime: string | null;
    registrantType: 'SELF' | 'GUARDIAN' | null;
    recipientName: string | null;
    recipientRelationship: string | null;
    recipientAge: number | null;
    recipientGender: string | null;
    district: string | null;
    city: string | null;
    careAddress: string | null;
    careNeeds: string | null;
    careSchedule: string | null;
    careStart: string | null;
    preferredCaregiverGender: string | null;
  };
  /** Null while no caregiver is attached yet. */
  caregiver: {
    id: string;
    publicId: string;
    fullName: string;
    registrationNumber: string;
    status: CaregiverStatus;
    deleted: boolean;
    gender: string;
    primaryPhone: string | null;
    secondaryPhone: string | null;
    email: string | null;
    district: string | null;
    city: string | null;
  } | null;
  events: CareRequestEvent[];
}

export interface CareRequestSummary {
  byStatus: Record<CareRequestStatus, number>;
  open: number;
  new: number;
  /** Open requests with no caregiver attached yet. */
  unmatched: number;
}

/** A first-time caller, as POST /care-requests `newClient` expects. */
export interface PhoneClientInput {
  fullName: string;
  phone: string;
  email?: string;
  consentConfirmed: boolean;
  registrantType: 'SELF' | 'GUARDIAN';
  recipientName?: string;
  recipientRelationship?: string;
  recipientAge: number;
  recipientGender: string;
  alternatePhone?: string;
  preferredContactMethod: string;
  preferredContactTime?: string;
  districtId: number;
  cityId: number;
  careAddress?: string;
  careNeeds: string;
  careSchedule: string;
  careStart: string;
  preferredCaregiverGender?: string;
}

export interface CreatePhoneRequestInput {
  patientId?: string;
  newClient?: PhoneClientInput;
  caregiverId?: string;
  message?: string;
  language: 'en' | 'si' | 'ta';
}
