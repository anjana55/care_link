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
 * CONCERN: something staff should read before deciding.
 */
export type OnboardingCheckState = 'OK' | 'TO_CHECK' | 'MISSING' | 'EXPIRED' | 'REJECTED' | 'WAITING' | 'CONCERN';
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
  documents: { type: string; status: string; expiresOn: string | null }[];
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
    const live = usable.filter((d) => !d.expiresOn || d.expiresOn >= f.today);
    let state: OnboardingCheckState;
    if (live.length) state = live.some((d) => d.status === 'VERIFIED') ? 'OK' : 'TO_CHECK';
    else if (usable.length) state = 'EXPIRED';
    else state = mine.length ? 'REJECTED' : 'MISSING';
    if (state === 'MISSING' || state === 'EXPIRED' || state === 'REJECTED') missingDocuments.push(core.label);
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

/** The verification file as the staff caregiver page shows it. */
export interface OnboardingFileView {
  recommendation: OnboardingRecommendation;
  checks: OnboardingCheck[];
  assembledAt: string;
  documentsRequested: { documents: CoreDocumentLabel[]; at: string } | null;
  references: { id: string; name: string; relationship: string; sentAt: string | null; channel: string | null; answer: ReferenceAnswer | null }[];
}
