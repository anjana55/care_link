/**
 * Automation: "one rail, two drivers" (Settings > Automation).
 *
 * Every job - matching, booking, billing, live care, onboarding - is a series
 * of steps that either a staff member or an AI agent carries out through the
 * same services. Each function has a dial that says how much its agent may do,
 * and each action has a risk tier that says when a person must sign it off.
 * Switching back to manual changes who gets the next step; it never changes
 * systems, and it never cancels anything.
 *
 * One definition shared by the API (which enforces it) and the staff app
 * (which shows it), so the rules on screen are the rules that run.
 */

import type { AiProvider } from './ai';

// --- functions and their dial ---------------------------------------------------

/** One agent per function, each with its own dial. */
export const AUTOMATION_FUNCTIONS = ['INTAKE', 'MATCHING', 'BOOKING', 'BILLING', 'LIVE_CARE', 'ONBOARDING'] as const;
export type AutomationFunction = (typeof AUTOMATION_FUNCTIONS)[number];

/**
 * The limits an admin can set per action, and what applies when they set
 * none. Amounts are in LKR.
 */
export const ACTION_LIMITS: Partial<Record<string, { key: string; default: number; min: number; max: number }>> = {
  'billing.approve_payout': { key: 'maxAmount', default: 50_000, min: 0, max: 10_000_000 },
};

/** The agents that exist so far. The others have a dial, but nothing behind it yet. */
export const BUILT_AGENTS: readonly AutomationFunction[] = ['BILLING'];

/**
 * The dial, lowest to highest.
 *  - MANUAL: the agent does nothing; staff do everything (how every function ships).
 *  - SHADOW: the agent decides silently; its choice is logged and scored against what staff did.
 *  - ASSIST: the agent proposes each step; staff approve it.
 *  - AUTO:   the agent acts within its limits; staff see only exceptions.
 */
export const AUTOMATION_MODES = ['MANUAL', 'SHADOW', 'ASSIST', 'AUTO'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

// --- risk tiers ----------------------------------------------------------------

/**
 * How much is at stake in one action.
 *  0 read and draft - rank, summarise, draft a message
 *  1 reversible     - send an offer or a reminder, create a draft
 *  2 commitment     - confirm a booking, take a payment, approve a payout under the limit
 *  3 human only     - verify or suspend a caregiver, refunds, bank details, safety reports
 */
export const RISK_TIERS = [0, 1, 2, 3] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export const HUMAN_ONLY_TIER: RiskTier = 3;

export interface AutomationActionDef {
  function: AutomationFunction;
  tier: RiskTier;
  /** Plain-language name, shown on the Automation page and in decision logs. */
  label: string;
}

/**
 * Every action an agent can take or propose. An action that is not listed
 * here cannot be gated, so an agent cannot do it. The tier is fixed in code:
 * an admin can hold an action back, but can never lower its tier.
 */
export const AUTOMATION_ACTIONS = {
  // Intake
  'intake.draft_request': { function: 'INTAKE', tier: 0, label: 'Draft a care request from what the client said' },
  'intake.answer_question': { function: 'INTAKE', tier: 0, label: 'Answer a common question' },
  'intake.create_request': { function: 'INTAKE', tier: 1, label: 'Create the care request' },

  // Matching and dispatch
  'matching.rank_caregivers': { function: 'MATCHING', tier: 0, label: 'Rank matching caregivers, with reasons' },
  'matching.send_offer': { function: 'MATCHING', tier: 1, label: 'Offer the job to a caregiver' },
  'matching.introduce': { function: 'MATCHING', tier: 1, label: 'Put a shortlist in front of the client' },

  // Booking and roster
  'booking.create_draft': { function: 'BOOKING', tier: 1, label: 'Create a draft booking and its shifts' },
  'booking.line_up_understudy': { function: 'BOOKING', tier: 1, label: 'Line up a stand-in caregiver' },
  'booking.take_payment': { function: 'BOOKING', tier: 2, label: 'Take a payment or hold before confirming' },
  'booking.confirm': { function: 'BOOKING', tier: 2, label: 'Confirm a booking' },
  'booking.cancel': { function: 'BOOKING', tier: 3, label: 'Cancel a confirmed booking' },

  // Billing and payouts
  'billing.issue_invoice': { function: 'BILLING', tier: 1, label: 'Issue an invoice for completed shifts' },
  'billing.send_payment_reminder': { function: 'BILLING', tier: 1, label: 'Send a payment reminder' },
  'billing.draft_payout': { function: 'BILLING', tier: 1, label: 'Draft a caregiver payout' },
  'billing.record_payment': { function: 'BILLING', tier: 2, label: 'Match a received payment to an invoice' },
  'billing.approve_payout': { function: 'BILLING', tier: 2, label: 'Approve a payout under the limit' },
  'billing.approve_large_payout': { function: 'BILLING', tier: 3, label: 'Approve a payout over the limit' },
  'billing.refund': { function: 'BILLING', tier: 3, label: 'Refund or write off an amount' },
  'billing.change_bank_details': { function: 'BILLING', tier: 3, label: "Change a caregiver's payout bank details" },
  'billing.amend_billed_booking': { function: 'BILLING', tier: 3, label: 'Amend a booking that was already billed' },

  // Live care
  'live_care.triage_issue': { function: 'LIVE_CARE', tier: 0, label: 'Sort an issue report by urgency' },
  'live_care.chase_late_caregiver': { function: 'LIVE_CARE', tier: 1, label: 'Chase a caregiver who has not checked in' },
  'live_care.nudge_care_plan': { function: 'LIVE_CARE', tier: 1, label: 'Remind the client to tick off care' },
  'live_care.replace_caregiver': { function: 'LIVE_CARE', tier: 2, label: 'Replace a caregiver on a shift' },
  'live_care.close_safety_report': { function: 'LIVE_CARE', tier: 3, label: 'Close a safety, abuse or medical report' },

  // Onboarding
  'onboarding.read_document': { function: 'ONBOARDING', tier: 0, label: 'Read an uploaded document and check it' },
  'onboarding.recommend_verification': { function: 'ONBOARDING', tier: 0, label: 'Assemble a verification file with a recommendation' },
  'onboarding.follow_up_reference': { function: 'ONBOARDING', tier: 1, label: 'Follow up a reference' },
  'onboarding.request_document': { function: 'ONBOARDING', tier: 1, label: 'Ask the caregiver for a missing or clearer document' },
  'onboarding.set_verification': { function: 'ONBOARDING', tier: 3, label: 'Mark a caregiver verified or rejected' },
  'onboarding.suspend_caregiver': { function: 'ONBOARDING', tier: 3, label: 'Suspend a caregiver' },
} as const satisfies Record<string, AutomationActionDef>;

export type AutomationActionKey = keyof typeof AUTOMATION_ACTIONS;
export const AUTOMATION_ACTION_KEYS = Object.keys(AUTOMATION_ACTIONS) as AutomationActionKey[];

export function isAutomationAction(key: unknown): key is AutomationActionKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(AUTOMATION_ACTIONS, key);
}

export function automationAction(key: AutomationActionKey): AutomationActionDef {
  return AUTOMATION_ACTIONS[key];
}

// --- cases and who drives them -----------------------------------------------------

/** The records an agent can be working on. */
export const AUTOMATION_CASE_TYPES = ['REQUEST', 'BOOKING', 'SHIFT', 'INVOICE', 'PAYOUT', 'CAREGIVER'] as const;
export type AutomationCaseType = (typeof AUTOMATION_CASE_TYPES)[number];

/**
 * Which agents work on which kind of record. A case page shows its automation
 * panel only while one of these is switched on (or the case already has
 * history), so with everything in Manual the pages look exactly as before.
 */
export const CASE_TYPE_FUNCTIONS: Record<AutomationCaseType, readonly AutomationFunction[]> = {
  REQUEST: ['INTAKE', 'MATCHING'],
  BOOKING: ['BOOKING', 'LIVE_CARE', 'BILLING'],
  SHIFT: ['LIVE_CARE'],
  INVOICE: ['BILLING'],
  PAYOUT: ['BILLING'],
  CAREGIVER: ['ONBOARDING'],
};

/** STAFF once someone pressed "Take over"; AGENT otherwise (when the function's dial allows it). */
export const CASE_DRIVERS = ['AGENT', 'STAFF'] as const;
export type CaseDriver = (typeof CASE_DRIVERS)[number];

/** Who asked for a person: a staff member on the case page, or the client / caregiver ("Talk to a person"). */
export const TAKEOVER_SOURCES = ['STAFF', 'PERSON'] as const;
export type TakeoverSource = (typeof TAKEOVER_SOURCES)[number];

/**
 * What the agent keeps up to date on every case it drives, so a person who
 * takes over reads three lines instead of reconstructing the history.
 */
export interface HandoverNote {
  /** What has been done so far. */
  done: string;
  /** What the case is waiting on. */
  waiting: string;
  /** What the agent was about to do, and why. */
  next: string;
}

export const MAX_HANDOVER_LINE = 500;

// --- the gate ------------------------------------------------------------------

/**
 * What an agent may do with one action, right now:
 *  - NONE:    nothing; a person is doing this.
 *  - SHADOW:  decide and log only; nobody sees it and nothing changes.
 *  - PROPOSE: put it in front of staff for approval.
 *  - EXECUTE: do it.
 */
export const GATE_OUTCOMES = ['NONE', 'SHADOW', 'PROPOSE', 'EXECUTE'] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export interface GateInput {
  /** The function's dial, after the master switch and any trip have been applied. */
  mode: AutomationMode;
  tier: RiskTier;
  /** Tier 2 only: has this action earned acting alone (and is it still allowed to)? */
  autoAllowed: boolean;
  /** Who is driving this case. Leave out for work that is not about one case. */
  driver?: CaseDriver;
}

/**
 * The whole rule in one place.
 *
 * A person's takeover beats everything. In Shadow nothing shows, whatever the
 * tier. Reading and drafting (tier 0) runs in Assist and Auto. Reversible
 * steps (tier 1) run alone only in Auto. Commitments (tier 2) run alone only
 * in Auto AND once earned. Tier 3 is never more than a proposal.
 */
export function resolveGate(input: GateInput): GateOutcome {
  if (input.driver === 'STAFF') return 'NONE';
  switch (input.mode) {
    case 'MANUAL':
      return 'NONE';
    case 'SHADOW':
      return 'SHADOW';
    case 'ASSIST':
      return input.tier === 0 ? 'EXECUTE' : 'PROPOSE';
    case 'AUTO':
      if (input.tier <= 1) return 'EXECUTE';
      if (input.tier === 2 && input.autoAllowed) return 'EXECUTE';
      return 'PROPOSE';
  }
}

/** The dial as it actually applies: Manual while the master switch is on or the function has tripped. */
export function effectiveMode(mode: AutomationMode, opts: { masterManual: boolean; tripped: boolean }): AutomationMode {
  return opts.masterManual || opts.tripped ? 'MANUAL' : mode;
}

// --- decisions and earning autonomy ---------------------------------------------

/** What became of a decision: logged in Shadow, proposed to staff, or carried out. */
export const DECISION_OUTCOMES = ['SHADOW', 'PROPOSED', 'EXECUTED'] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * What staff made of it.
 *  - AGREED:   staff did the same (Shadow), or approved the proposal.
 *  - DIFFERED: staff did something else (Shadow), or turned the proposal down.
 *  - REVERSED: the agent acted and staff undid it.
 *  - SERIOUS:  it would have been, or was, a serious mistake. Blocks promotion.
 */
export const STAFF_VERDICTS = ['AGREED', 'DIFFERED', 'REVERSED', 'SERIOUS'] as const;
export type StaffVerdict = (typeof STAFF_VERDICTS)[number];

/** The bar an action must clear before it may act alone, and when it loses that. */
export interface PromotionBar {
  /** How many judged decisions are needed. */
  cases: number;
  /** Percentage of them staff agreed with, 0-100. */
  agreementPercent: number;
  /** Reversals in one day that take the action back to needing approval. */
  demoteAfterReversals: number;
}

export const DEFAULT_PROMOTION_BAR: PromotionBar = { cases: 50, agreementPercent: 90, demoteAfterReversals: 3 };

/** An action's record against staff, over the judged decisions since it was last demoted. */
export interface ActionRecord {
  judged: number;
  agreed: number;
  serious: number;
}

export function agreementPercent(record: ActionRecord): number | null {
  return record.judged ? Math.round((record.agreed / record.judged) * 100) : null;
}

/** Has this action earned acting alone? Enough cases, enough agreement, and no serious miss. */
export function meetsPromotionBar(record: ActionRecord, bar: PromotionBar): boolean {
  if (record.serious > 0) return false;
  if (record.judged < bar.cases) return false;
  return record.agreed * 100 >= bar.agreementPercent * record.judged;
}

// --- data classes and AI endpoints ------------------------------------------------

/**
 * How sensitive a piece of data is, lowest to highest.
 *  - PUBLIC:    what the public site already shows (district, skills, ratings), plus ids and references.
 *  - PERSONAL:  names, contact details, addresses, money.
 *  - SENSITIVE: health notes, NIC / passport numbers, uploaded documents.
 */
export const DATA_CLASSES = ['PUBLIC', 'PERSONAL', 'SENSITIVE'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** The higher of the classes given: a prompt is as sensitive as the most sensitive thing in it. */
export function maxDataClass(...classes: DataClass[]): DataClass {
  return classes.reduce<DataClass>((max, c) => (DATA_CLASSES.indexOf(c) > DATA_CLASSES.indexOf(max) ? c : max), 'PUBLIC');
}

/** May data of class `data` be sent to an endpoint cleared up to `clearedFor`? */
export function isClearedFor(clearedFor: DataClass, data: DataClass): boolean {
  return DATA_CLASSES.indexOf(clearedFor) >= DATA_CLASSES.indexOf(data);
}

/**
 * One AI model an agent can be pointed at (Settings > Automation). Separate
 * from Settings > AI, which keeps running search and the staff assistant.
 * `clearedFor` is the most sensitive class of data this endpoint may ever be
 * sent - enforced in code on every call, whatever the prompt says.
 */
export interface AutomationEndpoint {
  id: string;
  name: string;
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  temperature: number | null;
  maxTokens: number;
  timeoutMs: number;
  clearedFor: DataClass;
  /** The functions that use it, as main or backup model. */
  usedBy: AutomationFunction[];
}

export interface AutomationEndpointInput {
  name?: string;
  enabled?: boolean;
  provider?: AiProvider;
  baseUrl?: string;
  model?: string;
  /** Write-only. Leave out to keep the stored key. */
  apiKey?: string;
  clearApiKey?: boolean;
  temperature?: number | null;
  maxTokens?: number;
  timeoutMs?: number;
  clearedFor?: DataClass;
}

export interface AutomationEndpointTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  message: string;
}

// --- what the staff app reads ---------------------------------------------------

export interface AutomationActionStatus extends AutomationActionDef {
  key: AutomationActionKey;
  /** Tier 2: allowed to act alone in Auto. Always false for other tiers (0-1 need no permission; 3 can never have it). */
  autoAllowed: boolean;
  record: ActionRecord;
  agreementPercent: number | null;
  /** Tier 2 only: the record clears the bar, so an admin may switch autoAllowed on. */
  eligibleForAuto: boolean;
  promotedAt: string | null;
  demotedAt: string | null;
  /** Admin limits for this action, e.g. { maxAmount: 50000 } (LKR). Null: the agent's own default. */
  limits: Record<string, number> | null;
}

export interface AutomationFunctionStatus {
  key: AutomationFunction;
  /** Where the admin set the dial. */
  mode: AutomationMode;
  /** What applies now (Manual while tripped or under the master switch). */
  effectiveMode: AutomationMode;
  trippedAt: string | null;
  tripReason: string | null;
  /** The model this agent uses, and the one it falls back to. Null: none chosen. */
  endpointId: string | null;
  fallbackEndpointId: string | null;
  actions: AutomationActionStatus[];
  /** Decisions in the last 7 days, by outcome. */
  recent: Record<DecisionOutcome, number>;
  /** Proposals waiting for a staff verdict. */
  awaitingStaff: number;
}

/** The background job queue the agents' follow-up steps run on. */
export interface JobsSummary {
  pending: number;
  running: number;
  failed: number;
  /** How long the oldest job that is already due has been waiting. */
  oldestDueMinutes: number | null;
  recentFailures: { id: string; type: string; lastError: string | null; finishedAt: string | null }[];
}

export interface AutomationOverview {
  /** The server was started with AUTOMATION_ENABLED=false: everything is manual and the page cannot change that. */
  disabledByServer: boolean;
  masterManual: boolean;
  masterReason: string | null;
  masterAt: string | null;
  bar: PromotionBar;
  /** Cases a person has taken over and not handed back, across every function. */
  casesTakenOver: number;
  endpoints: AutomationEndpoint[];
  jobs: JobsSummary;
  functions: AutomationFunctionStatus[];
}

export interface CaseControlView {
  caseType: AutomationCaseType;
  caseId: string;
  driver: CaseDriver;
  takenOverAt: string | null;
  takenOverByUserId: string | null;
  /** The staff member's name, for "Taken over by ...". */
  takenOverByName: string | null;
  takeoverSource: TakeoverSource | null;
  takeoverReason: string | null;
  handoverNote: HandoverNote | null;
  handoverNoteAt: string | null;
}

/** Everything a case page shows about automation, in one call. */
export interface CaseAutomationView extends CaseControlView {
  /** An agent that works on this kind of record is switched on right now. */
  agentActive: boolean;
  /** The highest dial among those agents, as it applies now. */
  mode: AutomationMode;
  /** The agents' latest decisions on this case, newest first. */
  decisions: AgentDecisionView[];
}

export interface AgentDecisionView {
  id: string;
  function: AutomationFunction;
  action: AutomationActionKey;
  actionLabel: string;
  tier: RiskTier;
  caseType: AutomationCaseType | null;
  caseId: string | null;
  mode: AutomationMode;
  outcome: DecisionOutcome;
  /** One plain line: why the agent chose this. */
  reason: string;
  confidence: number | null;
  proposal: Record<string, unknown> | null;
  model: string | null;
  staffVerdict: StaffVerdict | null;
  staffNote: string | null;
  reviewedAt: string | null;
  /** When the step was actually carried out (at once in Auto; on approval in Assist). */
  executedAt: string | null;
  /** Why carrying it out failed, if it did. A failed approval stays waiting. */
  executionError: string | null;
  /** What carrying it out produced, e.g. { invoiceId, number }. */
  result: Record<string, unknown> | null;
  createdAt: string;
}

/** A proposal still waiting for staff: approve it or turn it down. */
export function awaitsStaff(d: Pick<AgentDecisionView, 'outcome' | 'staffVerdict'>): boolean {
  return d.outcome === 'PROPOSED' && d.staffVerdict === null;
}

/** What one run of an agent did, for "Run now". */
export interface AgentRunResult {
  function: AutomationFunction;
  /** The dial as it applied during the run. */
  mode: AutomationMode;
  /** Cases looked at. */
  considered: number;
  /** New decisions logged (silently, as proposals, or carried out). */
  decided: number;
  /** Shadow decisions scored against what staff did. */
  scored: number;
  /** Cases left to staff, with the reason in their handover note. */
  leftToStaff: number;
}
