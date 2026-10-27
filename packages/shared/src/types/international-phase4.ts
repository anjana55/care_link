// International phase 4: training results and certificates of completion,
// interviews and job offers, departure and welfare abroad, and reports.
//
// Runtime code here (constants, small pure helpers) must stay plain
// JavaScript with no dependencies: the API loads this package at boot.

import type { CountryCode, CurrencyCode, EmployerType, PlacementStatus, SalaryPeriod } from './international';

// --- assessments -------------------------------------------------------------------

export const assessmentKindValues = ['ENGLISH', 'CAREGIVING_SKILLS', 'OTHER'] as const;
export type AssessmentKind = (typeof assessmentKindValues)[number];

/** Who ran the test. PLATFORM: our own assessment, at the end of a programme or on its own. */
export const assessmentProviderValues = ['PLATFORM', 'IELTS', 'OET', 'PTE', 'TOEFL', 'LANGUAGECERT', 'OTHER'] as const;
export type AssessmentProvider = (typeof assessmentProviderValues)[number];

/** Common European Framework levels: one scale employers everywhere read, whatever the test. */
export const cefrLevelValues = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof cefrLevelValues)[number];

export const ASSESSMENT_LIMITS = { title: 120, score: 20, note: 500 } as const;

/** A test result: an English test, a skills assessment. Shown publicly only once staff verified it against the original. */
export interface CaregiverAssessment {
  id: string;
  kind: AssessmentKind;
  provider: AssessmentProvider;
  /** "IELTS General Training", "Basic caregiving practical". */
  title: string;
  /** As the test reports it: "6.5", "B", "72/100". */
  score: string | null;
  cefrLevel: CefrLevel | null;
  takenOn: string;
  validUntil: string | null;
  verified: boolean;
  /** Recorded by the caregiver (waits for staff) or by staff. */
  addedBy: 'CAREGIVER' | 'STAFF';
  createdAt: string;
}

/** Staff view, with whose it is. */
export interface StaffAssessment extends CaregiverAssessment {
  caregiverId: string;
  registrationNumber: string;
  fullName: string;
  note: string | null;
  verifiedAt: string | null;
}

export interface AssessmentInput {
  kind: AssessmentKind;
  provider: AssessmentProvider;
  title: string;
  score?: string | null;
  cefrLevel?: CefrLevel | null;
  /** YYYY-MM-DD */
  takenOn: string;
  validUntil?: string | null;
  /** Staff only. */
  note?: string | null;
}

/** On a talent profile: verified results that have not run out. */
export interface PublicAssessment {
  kind: AssessmentKind;
  provider: AssessmentProvider;
  title: string;
  score: string | null;
  cefrLevel: CefrLevel | null;
  takenOn: string;
}

/** Whether a result still counts today. */
export function assessmentCurrent(a: { validUntil: string | null }, today: string): boolean {
  return !a.validUntil || a.validUntil >= today;
}

// --- certificates of completion ---------------------------------------------------------

/**
 * A certificate that the holder completed one of the platform's programmes.
 * Not an accredited qualification, and never worded as one.
 */
export interface TrainingCertificate {
  id: string;
  /** "TC-2026-K7Q2M9": printed on the certificate. */
  number: string;
  /** For the public check: /verify/<code>. */
  verifyCode: string;
  programmeId: string;
  /** In English, frozen when issued. */
  programmeTitle: string;
  holderName: string;
  issuedOn: string;
  score: number | null;
  revoked: boolean;
  revokedReason: string | null;
}

/** What anyone with the code can see: enough to match the paper, nothing to find the person. */
export interface PublicCertificateCheck {
  number: string;
  /** First name only. */
  firstName: string;
  programmeTitle: string;
  issuedOn: string;
  status: 'VALID' | 'REVOKED';
}

/** On a talent profile. */
export interface PublicCertificate {
  number: string;
  verifyCode: string;
  programmeTitle: string;
  issuedOn: string;
}

/** A code is 12 characters from an alphabet with no look-alikes (no 0/O, 1/I/L). */
export const CERTIFICATE_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

// --- interviews -------------------------------------------------------------------------

export const interviewModeValues = ['VIDEO', 'PHONE', 'IN_PERSON'] as const;
export type InterviewMode = (typeof interviewModeValues)[number];

/** SCHEDULED: booked. COMPLETED: it took place. CANCELLED: called off. NO_SHOW: someone did not attend. */
export const interviewStatusValues = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export type InterviewStatus = (typeof interviewStatusValues)[number];

export const INTERVIEW_LIMITS = { link: 500, location: 300, instructions: 1000, feedback: 2000, reason: 500 } as const;

/** An interview as both sides see it: when, how, and what to do. */
export interface Interview {
  id: string;
  candidateId: string;
  round: number;
  /** ISO, UTC. Each side's screen shows it in their own time zone. */
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewMode;
  meetingLink: string | null;
  location: string | null;
  instructions: string | null;
  status: InterviewStatus;
  cancelReason: string | null;
}

/** The employer's view adds their own feedback. */
export interface EmployerInterview extends Interview {
  feedback: string | null;
}

/** Staff see everything, and whose interview it is. */
export interface StaffInterview extends EmployerInterview {
  enquiryId: string;
  enquiryReference: string;
  organisationName: string;
  caregiverId: string;
  fullName: string;
  registrationNumber: string;
}

/** The caregiver's view: the country and kind of employer, never who. */
export interface CaregiverInterview extends Interview {
  country: string;
  organisationType: EmployerType;
}

export interface InterviewInput {
  /** ISO with offset, or UTC. */
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewMode;
  meetingLink?: string | null;
  location?: string | null;
  instructions?: string | null;
}

export interface InterviewUpdate extends Partial<InterviewInput> {
  status?: InterviewStatus;
  cancelReason?: string | null;
}

/**
 * The interview as an iCalendar file, so either side can add it to their
 * calendar in one tap. Built in the browser; nothing is sent anywhere.
 */
export function interviewIcs(i: Pick<Interview, 'id' | 'scheduledAt' | 'durationMinutes' | 'mode' | 'meetingLink' | 'location' | 'instructions'>, summary: string, now = new Date()): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(i.scheduledAt);
  const end = new Date(start.getTime() + i.durationMinutes * 60_000);
  // RFC 5545: commas, semicolons and backslashes escaped; newlines as \n.
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const description = [i.meetingLink, i.instructions].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareLink//Interview//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:interview-${i.id}@carelink`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(summary)}`,
    ...(description ? [`DESCRIPTION:${esc(description)}`] : []),
    ...(i.location || i.meetingLink ? [`LOCATION:${esc(i.location || i.meetingLink!)}`] : []),
    ...(i.meetingLink ? [`URL:${i.meetingLink}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

// --- job offers -------------------------------------------------------------------------

/**
 * PENDING_REVIEW: the employer signed and sent it; staff check it before the
 * caregiver sees it. RETURNED: staff sent it back to the employer to change.
 * SENT: with the caregiver. ACCEPTED / DECLINED: the caregiver's answer.
 * WITHDRAWN: the employer took it back before an answer.
 */
export const offerStatusValues = ['PENDING_REVIEW', 'RETURNED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof offerStatusValues)[number];

export const accommodationValues = ['PROVIDED_FREE', 'PROVIDED_PAID', 'NOT_PROVIDED'] as const;
export type Accommodation = (typeof accommodationValues)[number];

export const flightsPaidByValues = ['EMPLOYER', 'CAREGIVER', 'SHARED'] as const;
export type FlightsPaidBy = (typeof flightsPaidByValues)[number];

export const OFFER_LIMITS = { jobTitle: 150, city: 100, otherTerms: 3000, signature: 120, reason: 500 } as const;

/** Days a caregiver has to answer, unless the employer sets another date. */
export const DEFAULT_OFFER_VALID_DAYS = 14;

/** What the employer is offering. Signatures are over exactly these fields. */
export interface OfferTerms {
  jobTitle: string;
  country: CountryCode;
  city: string | null;
  /** YYYY-MM-DD: the expected start, subject to the visa. */
  startDate: string | null;
  contractMonths: number;
  hoursPerWeek: number;
  salaryAmount: number;
  salaryCurrency: CurrencyCode;
  salaryPeriod: SalaryPeriod;
  accommodation: Accommodation;
  mealsProvided: boolean;
  flightsPaidBy: FlightsPaidBy;
  annualLeaveDays: number | null;
  probationMonths: number | null;
  otherTerms: string | null;
}

export interface OfferInput extends OfferTerms {
  /** YYYY-MM-DD: the last day the caregiver can accept. */
  expiresOn?: string | null;
  /** The employer's typed name: their signature. */
  signatureName: string;
}

export interface OfferSignature {
  name: string;
  signedAt: string;
}

/** An offer, as the employer and staff see it. */
export interface JobOffer extends OfferTerms {
  id: string;
  reference: string;
  candidateId: string;
  enquiryId: string;
  enquiryReference: string;
  status: OfferStatus;
  /** SENT and past its date: it can no longer be accepted. */
  expired: boolean;
  expiresOn: string | null;
  employerSignature: OfferSignature | null;
  caregiverSignature: OfferSignature | null;
  /** Fingerprint of the terms both signatures cover. */
  termsHash: string;
  reviewNote: string | null;
  declineReason: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The employer's view names the caregiver by first name. */
export interface EmployerJobOffer extends JobOffer {
  talentFirstName: string;
}

/** Staff see whose it is and from whom. */
export interface StaffJobOffer extends JobOffer {
  organisationName: string;
  caregiverId: string;
  fullName: string;
  registrationNumber: string;
}

/** The caregiver's view: the employer by kind and country only - staff give the rest. */
export interface CaregiverJobOffer extends Omit<JobOffer, 'enquiryId' | 'enquiryReference' | 'reviewNote'> {
  organisationType: EmployerType;
}

export interface OfferReview {
  action: 'SEND' | 'RETURN';
  note?: string | null;
}

export interface OfferResponse {
  action: 'ACCEPT' | 'DECLINE';
  /** Required to accept: the caregiver's full name, typed. */
  signatureName?: string;
  reason?: string | null;
}

/**
 * The terms in a fixed order, as text, for fingerprinting. Any change to a
 * term changes the fingerprint, so a signature can never carry over to
 * terms the signer did not see.
 */
export function canonicalOfferTerms(t: OfferTerms): string {
  const ordered: (keyof OfferTerms)[] = [
    'jobTitle',
    'country',
    'city',
    'startDate',
    'contractMonths',
    'hoursPerWeek',
    'salaryAmount',
    'salaryCurrency',
    'salaryPeriod',
    'accommodation',
    'mealsProvided',
    'flightsPaidBy',
    'annualLeaveDays',
    'probationMonths',
    'otherTerms',
  ];
  return JSON.stringify(ordered.map((k) => [k, t[k] ?? null]));
}

// --- departure ----------------------------------------------------------------------------

/** What has to be done before a caregiver flies, in roughly the order it happens. */
export const departureItemValues = [
  'OFFER_ACCEPTED',
  'MEDICAL',
  'POLICE_CLEARANCE',
  'CONTRACT_SIGNED',
  'VISA_APPLIED',
  'VISA_GRANTED',
  'INSURANCE',
  'ORIENTATION',
  'FLIGHT_BOOKED',
] as const;
export type DepartureItem = (typeof departureItemValues)[number];

export interface DepartureChecklistItem {
  item: DepartureItem;
  done: boolean;
  doneOn: string | null;
  dueOn: string | null;
  /** Shown to the caregiver: what to bring, where to go. */
  note: string | null;
}

export interface DepartureItemUpdate {
  done?: boolean;
  doneOn?: string | null;
  dueOn?: string | null;
  note?: string | null;
}

/** Where the caregiver is, abroad. They keep it up to date; staff can too. */
export interface ContactAbroad {
  addressAbroad: string | null;
  phoneAbroad: string | null;
}

export const CONTACT_ABROAD_LIMITS = { address: 500, phone: 30, departureDetails: 300 } as const;

// --- welfare reports ------------------------------------------------------------------------

/** QUESTION < CONCERN < URGENT < SOS. SOS alerts every staff member at once. */
export const welfareSeverityValues = ['QUESTION', 'CONCERN', 'URGENT', 'SOS'] as const;
export type WelfareSeverity = (typeof welfareSeverityValues)[number];

export const welfareCategoryValues = ['PAY', 'HOURS', 'ACCOMMODATION', 'TREATMENT', 'HEALTH', 'CONTRACT', 'DOCUMENTS', 'SAFETY', 'OTHER'] as const;
export type WelfareCategory = (typeof welfareCategoryValues)[number];

/** OPEN: nobody from staff has replied. ACKNOWLEDGED: staff are on it. RESOLVED: closed. */
export const welfareStatusValues = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type WelfareStatus = (typeof welfareStatusValues)[number];

export const WELFARE_LIMITS = { message: 3000 } as const;

export interface WelfareMessage {
  id: string;
  from: 'CAREGIVER' | 'STAFF';
  body: string;
  createdAt: string;
}

export interface WelfareReport {
  id: string;
  reference: string;
  placementId: string;
  severity: WelfareSeverity;
  category: WelfareCategory;
  status: WelfareStatus;
  messages: WelfareMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Staff list and detail: whose, where, and how to reach them. */
export interface StaffWelfareReport extends WelfareReport {
  caregiverId: string;
  fullName: string;
  registrationNumber: string;
  country: string;
  organisationName: string;
  contact: ContactAbroad & { emergencyContactName: string | null; emergencyContactNumber: string | null; emergencyContactRelationship: string | null };
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export interface WelfareReportInput {
  severity: WelfareSeverity;
  category: WelfareCategory;
  /** Optional for an SOS only: the button alone is enough. */
  message?: string;
}

/**
 * Emergency numbers for the countries caregivers most often go to. Police
 * and ambulance where they differ. Anywhere else the caregiver is told to
 * call the local emergency number - 112 works from most mobile phones.
 */
export const EMERGENCY_NUMBERS: Partial<Record<CountryCode, { police: string; ambulance: string }>> = {
  AE: { police: '999', ambulance: '998' },
  AU: { police: '000', ambulance: '000' },
  BH: { police: '999', ambulance: '999' },
  CA: { police: '911', ambulance: '911' },
  CY: { police: '112', ambulance: '112' },
  DE: { police: '110', ambulance: '112' },
  FR: { police: '112', ambulance: '112' },
  GB: { police: '999', ambulance: '999' },
  IE: { police: '112', ambulance: '112' },
  IL: { police: '100', ambulance: '101' },
  IT: { police: '112', ambulance: '112' },
  JO: { police: '911', ambulance: '911' },
  JP: { police: '110', ambulance: '119' },
  KW: { police: '112', ambulance: '112' },
  MV: { police: '119', ambulance: '102' },
  NL: { police: '112', ambulance: '112' },
  NZ: { police: '111', ambulance: '111' },
  OM: { police: '9999', ambulance: '9999' },
  QA: { police: '999', ambulance: '999' },
  SA: { police: '911', ambulance: '911' },
  SG: { police: '999', ambulance: '995' },
  US: { police: '911', ambulance: '911' },
};

// --- what the caregiver and staff see on a placement ---------------------------------------

export interface PlacementJourney extends ContactAbroad {
  departureDetails: string | null;
  checklist: DepartureChecklistItem[];
}

// --- reports -----------------------------------------------------------------------------------

export interface ReportRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

export interface MoneyByCurrency {
  currency: string;
  /** Decimal string. */
  amount: string;
}

export interface OverseasReport {
  range: ReportRange;
  funnel: {
    enquiries: number;
    candidatesProposed: number;
    interviewsHeld: number;
    offersSent: number;
    offersAccepted: number;
    placements: number;
  };
  /** One row per calendar month in the range, oldest first. */
  monthly: { month: string; enquiries: number; placements: number; collected: MoneyByCurrency[] }[];
  timeToPlace: {
    /** Placements in the range that the numbers are over. */
    placements: number;
    /** Days from enquiry to placement. Null with no placements. */
    medianDays: number | null;
    averageDays: number | null;
    /** Days from the caregiver being put forward to being placed. */
    medianCandidateDays: number | null;
  };
  revenue: {
    /** Issued in the range. */
    invoiced: MoneyByCurrency[];
    /** Received in the range, net of refunds. */
    collected: MoneyByCurrency[];
    /** Unpaid on issued invoices now, whatever the range. */
    outstanding: MoneyByCurrency[];
    overdueInvoices: number;
    collectedByCountry: { country: string; currency: string; amount: string }[];
  };
  /** Demand (enquiries, vacancies, roles) against supply (caregivers open to the country) - busiest first. */
  demand: { country: string; enquiries: number; vacancies: number; roles: number; placements: number; talentPool: number }[];
  careSettings: { careSetting: string; enquiries: number; vacancies: number }[];
  outcomes: {
    /** Placements now, by status, whatever the range. */
    byStatus: Record<PlacementStatus, number>;
    endedEarly: number;
    endedEarlyInGuarantee: number;
    checkinsDue: number;
    checkinsDone: number;
    welfareBySeverity: Record<WelfareSeverity, number>;
  };
  training: {
    interested: number;
    completions: number;
    certificatesIssued: number;
    assessmentsVerified: number;
  };
}
