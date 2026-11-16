/**
 * The onboarding agent's rules: what an applicant caregiver's verification
 * file says, and what is still missing. Pure, so the API, its tests and the
 * staff page agree. The agent assembles the file and chases what is missing;
 * staff still decide - nobody is marked Verified by an agent.
 */
import { CORE_DOCUMENTS, type CoreDocumentLabel } from './notifications';

/** Caregivers the agent works on: signed up, not yet verified or rejected. */
export const ONBOARDING_STATUSES = ['REGISTERED', 'DOCUMENTS_PENDING', 'UNDER_VERIFICATION'] as const;
/** References a file wants confirmed before it says "ready". */
export const ONBOARDING_REFERENCES_WANTED = 2;
/** Days the caregiver has to upload what was asked for before staff are told. */
export const ONBOARDING_DOCUMENT_DAYS = 5;
/** Days a referee has to answer before staff are told; the link itself lasts longer. */
export const REFERENCE_ANSWER_DAYS = 7;
export const REFERENCE_LINK_DAYS = 21;
export const REFERENCE_COMMENT_MAX = 500;

export const PROFILE_GAPS = ['DATE_OF_BIRTH', 'ADDRESS', 'ID_NUMBER', 'AREA', 'EMERGENCY_CONTACT'] as const;
export type ProfileGap = (typeof PROFILE_GAPS)[number];

export const REFERENCE_YEARS = ['UNDER_1', 'ONE_TO_THREE', 'OVER_3'] as const;
export type ReferenceYears = (typeof REFERENCE_YEARS)[number];
export const REFERENCE_TRUST = ['YES', 'UNSURE', 'NO'] as const;
export type ReferenceTrust = (typeof REFERENCE_TRUST)[number];

/** A referee's three answers. `years` and `wouldTrust` are skipped by someone who does not know the caregiver. */
export interface ReferenceAnswerInput {
  knowsThem: boolean;
  years?: ReferenceYears;
  wouldTrust?: ReferenceTrust;
  comment?: string;
}
export interface ReferenceAnswer extends ReferenceAnswerInput {
  answeredAt: string;
}

/** What the referee's page shows: only who is asking about whom. */
export interface ReferenceCheck {
  caregiverName: string;
  relationship: string;
  refereeName: string;
  answered: boolean;
}

export type OnboardingCheckKey = 'IDENTITY' | 'POLICE' | 'GN' | 'PROFILE' | 'REFERENCES';
/**
 * OK: in and confirmed. TO_CHECK: in, for staff to look at. MISSING / EXPIRED /
 * REJECTED: the caregiver has to give it (again). WAITING: asked, no answer yet.
 * UNCLEAR: in, but the AI could not read it - ask for a clearer copy.
 * CONCERN: something staff should read before deciding.
 */
export type OnboardingCheckState = 'OK' | 'TO_CHECK' | 'MISSING' | 'EXPIRED' | 'REJECTED' | 'UNCLEAR' | 'WAITING' | 'CONCERN';
export interface OnboardingCheck {
  key: OnboardingCheckKey;
  state: OnboardingCheckState;
  /** Profile gaps, or for references: confirmed / wanted. */
  gaps?: ProfileGap[];
  confirmed?: number;
  wanted?: number;
}
/** READY: everything is in, for staff to decide. NOT_READY: something is missing or awaited. CONCERNS: read before deciding. */
export const ONBOARDING_RECOMMENDATIONS = ['READY', 'NOT_READY', 'CONCERNS'] as const;
export type OnboardingRecommendation = (typeof ONBOARDING_RECOMMENDATIONS)[number];

export interface OnboardingFacts {
  /** Colombo date, yyyy-mm-dd. */
  today: string;
  /** `reading`: the AI's comparison of the document with the profile, when one was made. */
  documents: { type: string; status: string; expiresOn: string | null; reading?: DocumentReadingOutcome | null }[];
  profile: {
    dateOfBirth: string | null;
    permanentAddress: string | null;
    nic: string | null;
    passportNumber: string | null;
    districtId: number | null;
    emergencyContactName: string | null;
    emergencyContactNumber: string | null;
  };
  references: { status: string; answer: ReferenceAnswer | null; sentAt: string | null }[];
}

export interface OnboardingFileResult {
  checks: OnboardingCheck[];
  recommendation: OnboardingRecommendation;
  /** Core documents the caregiver should upload (missing, expired or rejected). */
  missingDocuments: CoreDocumentLabel[];
}

const blank = (s: string | null | undefined) => !s || !s.trim();

export function profileGaps(p: OnboardingFacts['profile']): ProfileGap[] {
  const out: ProfileGap[] = [];
  if (!p.dateOfBirth) out.push('DATE_OF_BIRTH');
  if (blank(p.permanentAddress)) out.push('ADDRESS');
  if (blank(p.nic) && blank(p.passportNumber)) out.push('ID_NUMBER');
  if (p.districtId == null) out.push('AREA');
  if (blank(p.emergencyContactName) || blank(p.emergencyContactNumber)) out.push('EMERGENCY_CONTACT');
  return out;
}

/** A referee who does not know them, or would not trust them, is a concern; one who would is a confirmation. */
export function referenceState(r: OnboardingFacts['references'][number]): 'CONFIRMED' | 'CONCERN' | 'WAITING' | 'NOT_ASKED' {
  if (r.status === 'REJECTED') return 'CONCERN';
  if (r.answer) {
    if (!r.answer.knowsThem || r.answer.wouldTrust === 'NO') return 'CONCERN';
    return 'CONFIRMED';
  }
  if (r.status === 'VERIFIED') return 'CONFIRMED';
  return r.sentAt ? 'WAITING' : 'NOT_ASKED';
}

export function onboardingFile(f: OnboardingFacts): OnboardingFileResult {
  const checks: OnboardingCheck[] = [];
  const missingDocuments: CoreDocumentLabel[] = [];
  const keyOf: Record<CoreDocumentLabel, OnboardingCheckKey> = { identity: 'IDENTITY', police: 'POLICE', gn: 'GN' };
  for (const core of CORE_DOCUMENTS) {
    const mine = f.documents.filter((d) => (core.anyOf as readonly string[]).includes(d.type));
    const usable = mine.filter((d) => d.status !== 'REJECTED');
    // A document the AI read as expired counts as expired, whatever date was typed in.
    const live = usable.filter((d) => (!d.expiresOn || d.expiresOn >= f.today) && d.reading !== 'EXPIRED');
    const readings = live.map((d) => d.reading ?? null);
    let state: OnboardingCheckState;
    if (live.some((d) => d.status === 'VERIFIED')) state = 'OK';
    else if (live.length && readings.every((r) => r === 'UNREADABLE')) state = 'UNCLEAR';
    else if (live.length && readings.includes('MISMATCH') && !readings.includes('OK')) state = 'CONCERN';
    else if (live.length) state = 'TO_CHECK';
    else if (usable.length) state = 'EXPIRED';
    else state = mine.length ? 'REJECTED' : 'MISSING';
    if (state === 'MISSING' || state === 'EXPIRED' || state === 'REJECTED' || state === 'UNCLEAR') missingDocuments.push(core.label);
    checks.push({ key: keyOf[core.label], state });
  }
  const gaps = profileGaps(f.profile);
  checks.push(gaps.length ? { key: 'PROFILE', state: 'MISSING', gaps } : { key: 'PROFILE', state: 'OK' });

  const states = f.references.map(referenceState);
  const confirmed = states.filter((s) => s === 'CONFIRMED').length;
  const wanted = ONBOARDING_REFERENCES_WANTED;
  const refState: OnboardingCheckState = states.includes('CONCERN')
    ? 'CONCERN'
    : confirmed >= wanted
      ? 'OK'
      : f.references.length < wanted
        ? 'MISSING'
        : 'WAITING';
  checks.push({ key: 'REFERENCES', state: refState, confirmed, wanted });

  const recommendation: OnboardingRecommendation = checks.some((c) => c.state === 'CONCERN')
    ? 'CONCERNS'
    : checks.some((c) => c.state !== 'OK' && c.state !== 'TO_CHECK')
      ? 'NOT_READY'
      : 'READY';
  return { checks, recommendation, missingDocuments };
}

// ---- AI reading of a document ----

/** Documents the agent reads: the core ones. */
export const READABLE_DOCUMENT_TYPES = ['NIC', 'PASSPORT', 'POLICE_CLEARANCE', 'GRAMA_NILADHARI_CERTIFICATE'] as const;
export const DOCUMENT_READING_OUTCOMES = ['OK', 'CHECK', 'MISMATCH', 'EXPIRED', 'UNREADABLE'] as const;
/** OK: everything shown matches. CHECK: something not shown or only partly matching. MISMATCH / EXPIRED: read before deciding. UNREADABLE: ask for a clearer copy. */
export type DocumentReadingOutcome = (typeof DOCUMENT_READING_OUTCOMES)[number];
export type ReadingCheckKey = 'TYPE' | 'NAME' | 'ID_NUMBER' | 'DATE_OF_BIRTH' | 'EXPIRY';
export type ReadingCheckResult = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'NOT_SHOWN' | 'VALID' | 'EXPIRED';
export interface ReadingCheck {
  check: ReadingCheckKey;
  result: ReadingCheckResult;
}
/** What the model said the document shows. Compared in code; only the comparison is kept. */
export interface DocumentRead {
  legible: boolean;
  documentType: string | null;
  fullName: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
  expiresOn: string | null;
}
export interface DocumentReadingResult {
  outcome: DocumentReadingOutcome;
  checks: ReadingCheck[];
  /** The expiry date shown on the document, so staff can fill it in. */
  expiresOn: string | null;
}

const nameTokens = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

/** Sri Lankan names often appear with initials or in another order: count whole words in common. */
export function nameMatch(read: string, profile: string): 'MATCH' | 'PARTIAL' | 'MISMATCH' {
  const a = nameTokens(read);
  const b = nameTokens(profile);
  const common = a.filter((t) => b.includes(t)).length;
  if (common > 0 && common >= Math.min(2, a.length, b.length)) return 'MATCH';
  return common ? 'PARTIAL' : 'MISMATCH';
}

/** The 12-digit form of an NIC number; an old 9-digit + V/X number is converted (19YY DDD 0 NNNN). */
export function nicDigits(nic: string): string {
  const s = nic.toUpperCase().replace(/[^0-9VX]/g, '');
  const old = s.match(/^(\d{2})(\d{3})(\d{4})[VX]$/);
  return old ? `19${old[1]}${old[2]}0${old[3]}` : s;
}

const sameNumber = (type: string, read: string, profile: string) =>
  type === 'NIC' ? nicDigits(read) === nicDigits(profile) : read.toUpperCase().replace(/[^0-9A-Z]/g, '') === profile.toUpperCase().replace(/[^0-9A-Z]/g, '');

export function compareReading(
  read: DocumentRead | null,
  doc: { type: string },
  profile: { fullName: string; nic: string | null; passportNumber: string | null; dateOfBirth: string | null },
  today: string,
): DocumentReadingResult {
  if (!read || !read.legible) return { outcome: 'UNREADABLE', checks: [], expiresOn: null };
  const checks: ReadingCheck[] = [];
  checks.push({ check: 'TYPE', result: !read.documentType ? 'NOT_SHOWN' : read.documentType === doc.type ? 'MATCH' : 'MISMATCH' });
  checks.push({ check: 'NAME', result: read.fullName ? nameMatch(read.fullName, profile.fullName) : 'NOT_SHOWN' });
  const own = doc.type === 'NIC' ? profile.nic : doc.type === 'PASSPORT' ? profile.passportNumber : null;
  if (own) checks.push({ check: 'ID_NUMBER', result: read.idNumber ? (sameNumber(doc.type, read.idNumber, own) ? 'MATCH' : 'MISMATCH') : 'NOT_SHOWN' });
  if (read.dateOfBirth && profile.dateOfBirth) checks.push({ check: 'DATE_OF_BIRTH', result: read.dateOfBirth === profile.dateOfBirth ? 'MATCH' : 'MISMATCH' });
  if (read.expiresOn) checks.push({ check: 'EXPIRY', result: read.expiresOn < today ? 'EXPIRED' : 'VALID' });
  const results = checks.map((c) => c.result);
  const outcome: DocumentReadingOutcome = results.includes('EXPIRED')
    ? 'EXPIRED'
    : results.includes('MISMATCH')
      ? 'MISMATCH'
      : results.includes('NOT_SHOWN') || results.includes('PARTIAL')
        ? 'CHECK'
        : 'OK';
  return { outcome, checks, expiresOn: read.expiresOn };
}

/** A reading as the staff file shows it: the comparison only, never the values read. */
export interface DocumentReadingView extends DocumentReadingResult {
  documentId: string;
  documentType: string;
  model: string;
  readAt: string;
}

/** The verification file as the staff caregiver page shows it. */
export interface OnboardingFileView {
  recommendation: OnboardingRecommendation;
  checks: OnboardingCheck[];
  assembledAt: string;
  documentsRequested: { documents: CoreDocumentLabel[]; at: string } | null;
  references: { id: string; name: string; relationship: string; sentAt: string | null; channel: string | null; answer: ReferenceAnswer | null }[];
  readings: DocumentReadingView[];
}
