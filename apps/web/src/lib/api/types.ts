import type { CareType } from '@care-platform/shared';
import type {
  BillingAdjustmentView as SharedBillingAdjustmentView,
  BookingAmendmentView as SharedBookingAmendmentView,
  IssueReportView as SharedIssueReportView,
} from '@care-platform/shared';
import type { BillingLineKind, BillingParty, BillingUnit, DiscountType, InvoiceBasis, InvoiceStatus, PaymentMethod, PaymentType, PayoutStatus } from '@care-platform/shared';
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
  /** How the caregiver wants to be reached first; null until they (or staff) choose. */
  preferredContactMethod: ContactMethod | null;
  status: CaregiverStatus;
  /** Tell the caregiver straight away when a client asks for them. */
  autoNotifyRequests: boolean;
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
  careTypes?: CareType[];
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
  /** The phone on the caregiver record - where claim codes go by WhatsApp. */
  contactPhone: string | null;
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

export interface ChangeCaregiverContactRequest {
  email?: string;
  phone?: string;
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
  caregiverAutoNotify: boolean | null;
  /** When the caregiver was last told about it; null = not yet. */
  caregiverNotifiedAt: string | null;
  careType: CareType | null;
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
  type: 'CREATED' | 'STATUS_CHANGED' | 'NOTE' | 'ASSIGNED' | 'CANCELLED' | 'CAREGIVER_CHANGED' | 'CAREGIVER_NOTIFIED';
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
  /** Whether "Notify caregiver" can be used: a caregiver is attached and the request is open. */
  canNotifyCaregiver: boolean;
  caregiverNotifiedAt: string | null;
  /** What the request itself asks for (from the client's search or "find someone for me"). */
  careType: CareType | null;
  requestDistrict: string | null;
  requestCity: string | null;
  desiredStartDate: string | null;
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
    autoNotifyRequests: boolean;
    preferredContactMethod: ContactMethod | null;
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
  careType?: CareType;
  language: 'en' | 'si' | 'ta';
}

// --- bookings and shifts --------------------------------------------------------
export type BookingStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type ShiftStatus = 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
export type ScheduleType = 'DAY' | 'NIGHT' | 'LIVE_IN' | 'CUSTOM';
export type RateType = 'HOURLY' | 'DAILY' | 'MONTHLY';
/** A single shift's own rate: by its hours, or as a whole shift - never by the month. */
export type ShiftRateType = 'HOURLY' | 'DAILY';

export interface BookingListItem {
  id: string;
  reference: string;
  status: BookingStatus;
  scheduleType: ScheduleType;
  startDate: string;
  endDate: string;
  shiftStartTime: string;
  shiftEndTime: string;
  daysOfWeek: string;
  clientId: string;
  clientName: string;
  recipientName: string | null;
  caregiverId: string;
  caregiverName: string;
  caregiverRegistrationNumber: string;
  nextShiftAt: string | null;
  createdAt: string;
  /** Reports from the client or caregiver waiting for staff. */
  openIssues: number;
}

export interface BookingListResponse {
  items: BookingListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BookingCaregiverRef {
  id: string;
  fullName: string;
  registrationNumber: string;
  status: CaregiverStatus;
  deleted: boolean;
}

export interface BookingShift {
  id: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  status: ShiftStatus;
  note: string | null;
  /** This shift's own client rate; null = the booking's. */
  rateType: ShiftRateType | null;
  rateAmount: string | null;
  /** This shift's own pay rate; null = the booking's. */
  payRateType: ShiftRateType | null;
  payRateAmount: string | null;
  /** The client side is charged by the month, so this shift can't have its own client rate. */
  clientRateLocked: boolean;
  /** The booked caregiver is paid by the month, so this shift can't have its own pay rate. */
  payRateLocked: boolean;
  /** The live invoice / pay statement this shift is already on. */
  invoice: { id: string; number: string | null; status: string } | null;
  payout: { id: string; reference: string; status: string } | null;
  caregiver: BookingCaregiverRef | null;
  isCover: boolean;
  conflicts: { shiftId: string; withShiftId: string; withBookingId: string; withBookingReference: string; kind: 'BLOCKING' | 'DRAFT' }[];
  allowedStatuses: ShiftStatus[];
  updatedBy: StaffRef | null;
}

export interface BookingDetail {
  id: string;
  reference: string;
  status: BookingStatus;
  scheduleType: ScheduleType;
  daysOfWeek: number[];
  shiftStartTime: string;
  shiftEndTime: string;
  startDate: string;
  endDate: string;
  rateType: RateType | null;
  rateAmount: string | null;
  /** What the caregiver is paid. Staff only. */
  payRateType: RateType | null;
  payRateAmount: string | null;
  language: 'en' | 'si' | 'ta';
  notes: string | null;
  cancelReason: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: StaffRef | null;
  confirmedBy: StaffRef | null;
  careRequest: { id: string; reference: string; status: CareRequestStatus } | null;
  client: { id: string; fullName: string; phone: string | null; recipientName: string | null; city: string | null; district: string | null; careAddress: string | null } | null;
  caregiver: (BookingCaregiverRef & { primaryPhone: string | null }) | null;
  shifts: BookingShift[];
  estimate: BookingEstimate;
  payEstimate: BookingEstimate;
  blockingConflicts: number;
  events: { id: string; type: string; note: string | null; createdAt: string; actor: StaffRef | null }[];
}

export interface BookingEstimate {
  shifts: number;
  hours: number;
  rateType: RateType | null;
  rateAmount: string | null;
  /** Shifts going ahead that carry their own rate on this side. */
  ownRateShifts: number;
  /** Lines with no rate at all (neither the booking's nor their own). */
  unpriced: number;
  units: number | null;
  total: string | null;
}

/** PATCH /bookings/:id */
export interface UpdateBookingInput {
  rateType?: RateType | null;
  rateAmount?: string | null;
  payRateType?: RateType | null;
  payRateAmount?: string | null;
  notes?: string;
  language?: 'en' | 'si' | 'ta';
  caregiverId?: string;
  pattern?: BookingPatternInput;
  /** Confirmed bookings: the first day a pattern or caregiver change applies to. */
  effectiveFrom?: string;
}

/** A shift's own rates in an add / edit; null clears that side back to the booking's rate. */
export interface ShiftRateInput {
  rateType?: ShiftRateType | null;
  rateAmount?: string | null;
  payRateType?: ShiftRateType | null;
  payRateAmount?: string | null;
}

export interface BookingSummary {
  byStatus: Record<BookingStatus, number>;
  shiftsToday: number;
  /** Reports from clients and caregivers waiting for staff, across every booking. */
  openIssues: number;
}

export interface BookingPatternInput {
  scheduleType: ScheduleType;
  daysOfWeek: number[];
  shiftStartTime: string;
  shiftEndTime: string;
  startDate: string;
  endDate: string;
}

export interface CreateBookingInput extends BookingPatternInput {
  careRequestId?: string;
  patientId?: string;
  caregiverId?: string;
  rateType?: RateType;
  rateAmount?: string;
  payRateType?: RateType;
  payRateAmount?: string;
  language?: 'en' | 'si' | 'ta';
  notes?: string;
}

// --- booking corrections (amendments) and the adjustments they leave ----------------
export type {
  AmendAddShiftInput,
  AmendBookingInput,
  AmendShiftInput,
  AmendShiftStatus,
  AmendmentDocumentAction,
  AmendmentDocumentImpact,
  AmendmentPreview,
  BillingAdjustmentView,
  BookingAmendmentView,
  IssueReportCategory,
  IssueReportStatus,
  IssueReportView,
} from '@care-platform/shared';

/** GET /bookings/:id/amendments */
export interface BookingCorrections {
  amendments: SharedBookingAmendmentView[];
  adjustments: SharedBillingAdjustmentView[];
  /** What clients and caregivers have reported on the booking, newest first. */
  reports: SharedIssueReportView[];
}

// --- billing: invoices, payments, payouts ------------------------------------------
export type {
  BillingLineKind,
  BillingParty,
  BillingUnit,
  DiscountType,
  InvoiceBasis,
  InvoiceStatus,
  PaymentMethod,
  PaymentType,
  PayoutStatus,
} from '@care-platform/shared';

/** One editable line, as the API returns it (invoices and payouts share the shape). */
export interface BillingLine {
  id: string;
  position: number;
  kind: BillingLineKind;
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discountType: DiscountType | null;
  discountValue: string | null;
  amount: string;
  gross: string;
  discount: string;
  shiftId: string | null;
  bookingId: string | null;
  caregiverId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Invoices only. */
  taxable?: boolean;
}

/** What the editor sends back for one line. */
export interface BillingLineInput {
  id?: string;
  kind: BillingLineKind;
  description: string;
  serviceDate?: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discountType?: DiscountType | null;
  discountValue?: string | null;
  taxable?: boolean;
}

export interface Generated {
  added: number;
  skipped: number;
  unpriced: number;
}

export interface InvoiceListItem {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  basis: InvoiceBasis;
  issueDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  clientId: string;
  clientName: string;
  billToName: string;
  bookingId: string | null;
  bookingReference: string | null;
  createdAt: string;
}

export interface InvoiceListResponse {
  items: InvoiceListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface InvoiceSummary {
  byStatus: Record<InvoiceStatus, number>;
  outstanding: string;
  overdue: string;
  overdueCount: number;
  receivedThisMonth: string;
}

export interface InvoicePayment {
  id: string;
  amount: string;
  paymentType: PaymentType;
  /** Optional detail under the type (cheque, card...). PAYHERE for online payments PayHere recorded. */
  method: PaymentMethod | null;
  bankAccountId: string | null;
  /** The bank account's label, for BANK payments that named one. */
  bankAccount: string | null;
  paidOn: string;
  reference: string | null;
  note: string | null;
  recordedBy: StaffRef | null;
  createdAt: string;
}

export interface InvoiceDetail {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  basis: InvoiceBasis;
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  dueDate: string | null;
  language: 'en' | 'si' | 'ta';
  billToName: string;
  billToAddress: string | null;
  billToPhone: string | null;
  billToEmail: string | null;
  seller: BillingParty;
  footer: string | null;
  discountType: DiscountType | null;
  discountValue: string | null;
  discountReason: string | null;
  taxName: string | null;
  taxRate: string | null;
  subtotal: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  total: string;
  amountPaid: string;
  balance: string;
  overdue: boolean;
  notes: string | null;
  voidReason: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: StaffRef | null;
  issuedBy: StaffRef | null;
  client: { id: string; fullName: string; phone: string | null } | null;
  booking: { id: string; reference: string; rateType: RateType | null; rateAmount: string | null } | null;
  lines: BillingLine[];
  unpricedLines: number;
  tax: { available: boolean; name: string; rate: string };
  payhere: { usable: boolean };
  payments: InvoicePayment[];
  checkouts: { id: string; amount: string; status: string; mode: string; method: string | null; paymentId: string | null; createdAt: string; updatedAt: string }[];
  events: { id: string; type: string; note: string | null; createdAt: string; actor: StaffRef | null }[];
  /** Only on the response that made or refilled the draft. */
  generated?: Generated;
}

export interface CreateInvoiceInput {
  bookingId?: string;
  patientId?: string;
  basis: InvoiceBasis;
  periodStart?: string;
  periodEnd?: string;
  language?: 'en' | 'si' | 'ta';
}

export interface PayoutListItem {
  id: string;
  reference: string;
  status: PayoutStatus;
  periodStart: string;
  periodEnd: string;
  total: string;
  paidOn: string | null;
  caregiverId: string;
  caregiverName: string;
  caregiverRegistrationNumber: string;
  createdAt: string;
}

export interface PayoutListResponse {
  items: PayoutListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PayoutSummary {
  byStatus: Record<PayoutStatus, number>;
  approvedTotal: string;
}

export interface PayoutDetail {
  id: string;
  reference: string;
  status: PayoutStatus;
  periodStart: string;
  periodEnd: string;
  total: string;
  notes: string | null;
  paidOn: string | null;
  paymentType: PaymentType | null;
  paymentMethod: PaymentMethod | null;
  bankAccountId: string | null;
  bankAccount: string | null;
  paymentReference: string | null;
  voidReason: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  caregiver: { id: string; fullName: string; registrationNumber: string; primaryPhone: string | null } | null;
  lines: (BillingLine & { bookingReference: string | null })[];
  unpricedLines: number;
  createdBy: StaffRef | null;
  approvedBy: StaffRef | null;
  paidBy: StaffRef | null;
  generated?: Generated;
}

export interface BillingSettings {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  registrationNumber: string | null;
  taxEnabled: boolean;
  taxName: string;
  taxRate: string;
  taxRegistrationNumber: string | null;
  invoicePrefix: string;
  nextInvoiceNumber: number;
  paymentTermsDays: number;
  invoiceFooter: string | null;
  payhereEnabled: boolean;
  payhereMode: 'SANDBOX' | 'LIVE';
  payhereMerchantId: string | null;
  payhereMerchantSecretSet: boolean;
  payhereMerchantSecretLast4: string | null;
  payhereNotifyBaseUrl: string | null;
  payhereNotifyUrl: string;
  payhereCheckoutUrl: string;
  payhereUsable: boolean;
  updatedAt: string;
}
