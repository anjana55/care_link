import { mysqlTable, varchar, datetime, mysqlEnum, boolean, int, decimal, json, text, index, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import {
  AUTOMATION_CASE_TYPES,
  AUTOMATION_FUNCTIONS,
  AUTOMATION_MODES,
  CASE_DRIVERS,
  DATA_CLASSES,
  DECISION_OUTCOMES,
  STAFF_VERDICTS,
  TAKEOVER_SOURCES,
  type HandoverNote,
} from '@care-platform/shared';
import { aiProviderEnum } from './ai.schema';

/**
 * Automation-wide settings (Settings > Automation) - a single row, id
 * 'default', like the other settings.
 *
 * `master_manual` is the master switch: while it is on, every function runs
 * as Manual whatever its own dial says. The dials are left untouched, so
 * switching it off again puts each function back where it was.
 *
 * The promotion bar is what a tier-2 action must clear before an admin may let
 * it act alone, and how many same-day reversals take that away again.
 */
export const automationSettings = mysqlTable('automation_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  masterManual: boolean('master_manual').notNull().default(false),
  masterReason: varchar('master_reason', { length: 500 }),
  masterAt: datetime('master_at'),
  masterBy: varchar('master_by', { length: 36 }),

  promotionCases: int('promotion_cases').notNull().default(50),
  promotionAgreementPercent: int('promotion_agreement_percent').notNull().default(90),
  demoteAfterReversals: int('demote_after_reversals').notNull().default(3),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * One row per function (matching, billing, ...): where its dial is set, and
 * whether it has tripped. A function with no row is Manual - so a deployment
 * that never opens the page has exactly the manual system it shipped with.
 *
 * A trip (`tripped_at` set) makes the function Manual until an admin resets
 * it. `mode` is kept, so the reset can put the dial back.
 */
export const automationFunctions = mysqlTable('automation_functions', {
  key: mysqlEnum('key', AUTOMATION_FUNCTIONS).primaryKey(),
  mode: mysqlEnum('mode', AUTOMATION_MODES).notNull().default('MANUAL'),
  trippedAt: datetime('tripped_at'),
  tripReason: varchar('trip_reason', { length: 500 }),
  /** The AI model this agent uses (automation_endpoints.id), and the one it falls back to. */
  endpointId: varchar('endpoint_id', { length: 36 }),
  fallbackEndpointId: varchar('fallback_endpoint_id', { length: 36 }),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Per-action permission. The action's tier lives in code (shared
 * AUTOMATION_ACTIONS) and cannot be changed here; this row only says whether
 * a tier-2 action has been allowed to act alone in Auto, and since when its
 * record against staff is counted (`record_since` moves forward on a demotion
 * or an admin reset, so old agreement cannot be reused after a bad day).
 */
export const automationActionPolicies = mysqlTable('automation_action_policies', {
  action: varchar('action', { length: 64 }).primaryKey(),
  autoAllowed: boolean('auto_allowed').notNull().default(false),
  /** Admin limits for this action (amounts, hours); read by the agent that takes it. */
  limits: json('limits').$type<Record<string, number>>(),
  recordSince: datetime('record_since', { fsp: 3 }),
  promotedAt: datetime('promoted_at'),
  promotedBy: varchar('promoted_by', { length: 36 }),
  demotedAt: datetime('demoted_at'),
  demoteReason: varchar('demote_reason', { length: 255 }),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * Who is driving one case, and the agent's running handover note for it.
 *
 * A case with no row is driven by whoever the function's dial says. A row
 * with driver STAFF means someone pressed "Take over" (or the client or
 * caregiver asked for a person): the agent stops on that case only, until it
 * is handed back.
 */
export const automationCases = mysqlTable(
  'automation_cases',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caseType: mysqlEnum('case_type', AUTOMATION_CASE_TYPES).notNull(),
    caseId: varchar('case_id', { length: 36 }).notNull(),
    driver: mysqlEnum('driver', CASE_DRIVERS).notNull().default('AGENT'),
    takenOverAt: datetime('taken_over_at'),
    takenOverByUserId: varchar('taken_over_by_user_id', { length: 36 }),
    takeoverSource: mysqlEnum('takeover_source', TAKEOVER_SOURCES),
    takeoverReason: varchar('takeover_reason', { length: 500 }),
    handoverNote: json('handover_note').$type<HandoverNote>(),
    handoverNoteAt: datetime('handover_note_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    caseUnique: uniqueIndex('automation_cases_case_unique').on(t.caseType, t.caseId),
    driverIdx: index('automation_cases_driver_idx').on(t.driver, t.caseType),
  }),
);

/**
 * Every decision an agent makes, whatever came of it: logged silently in
 * Shadow, proposed to staff, or carried out. This is the audit trail of the
 * agents, the timeline staff see on a case, and - through `staff_verdict` -
 * the evidence an action is promoted or demoted on.
 *
 * `reason` is one plain line. `proposal` holds what the agent wanted to do,
 * as masked data (ids and references, never names, phone numbers or health
 * details). `model` and `prompt_version` say what produced it.
 */
export const agentDecisions = mysqlTable(
  'agent_decisions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    function: mysqlEnum('function', AUTOMATION_FUNCTIONS).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    tier: int('tier').notNull(),
    caseType: mysqlEnum('case_type', AUTOMATION_CASE_TYPES),
    caseId: varchar('case_id', { length: 36 }),
    mode: mysqlEnum('mode', AUTOMATION_MODES).notNull(),
    outcome: mysqlEnum('outcome', DECISION_OUTCOMES).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    confidence: decimal('confidence', { precision: 4, scale: 3, mode: 'number' }),
    proposal: json('proposal').$type<Record<string, unknown>>(),
    model: varchar('model', { length: 120 }),
    promptVersion: varchar('prompt_version', { length: 40 }),
    staffVerdict: mysqlEnum('staff_verdict', STAFF_VERDICTS),
    staffNote: varchar('staff_note', { length: 500 }),
    reviewedByUserId: varchar('reviewed_by_user_id', { length: 36 }),
    reviewedAt: datetime('reviewed_at'),
    /**
     * Stops the same step being decided twice: an agent that sweeps hourly
     * finds the same unbilled booking every hour. Unique per action and
     * outcome in practice (checked in decide()), so moving a dial from Shadow
     * to Assist does let the agent propose what it had only logged.
     */
    dedupeKey: varchar('dedupe_key', { length: 191 }),
    executedAt: datetime('executed_at', { fsp: 3 }),
    executionError: varchar('execution_error', { length: 500 }),
    result: json('result').$type<Record<string, unknown>>(),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    functionCreatedIdx: index('agent_decisions_function_created_idx').on(t.function, t.createdAt),
    actionCreatedIdx: index('agent_decisions_action_created_idx').on(t.action, t.createdAt),
    caseIdx: index('agent_decisions_case_idx').on(t.caseType, t.caseId, t.createdAt),
    reviewIdx: index('agent_decisions_review_idx').on(t.action, t.staffVerdict, t.reviewedAt),
    dedupeIdx: index('agent_decisions_dedupe_idx').on(t.action, t.dedupeKey),
  }),
);

/**
 * The AI models agents can be pointed at (Settings > Automation). Kept apart
 * from the single Settings > AI row, which goes on running search and the
 * staff assistant exactly as before.
 *
 * `cleared_for` is the most sensitive class of data the endpoint may be sent.
 * New endpoints start at PUBLIC: an admin has to say out loud that a model -
 * normally a self-hosted one - may see personal or sensitive data. The API key
 * is AES-GCM encrypted at rest, like the Settings > AI key.
 */
export const automationEndpoints = mysqlTable(
  'automation_endpoints',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    provider: mysqlEnum('provider', aiProviderEnum).notNull().default('OLLAMA'),
    baseUrl: varchar('base_url', { length: 255 }).notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    apiKeyEncrypted: text('api_key_encrypted'),
    temperature: decimal('temperature', { precision: 3, scale: 2 }).default('0.20'),
    maxTokens: int('max_tokens').notNull().default(1024),
    timeoutMs: int('timeout_ms').notNull().default(30000),
    clearedFor: mysqlEnum('cleared_for', DATA_CLASSES).notNull().default('PUBLIC'),
    updatedBy: varchar('updated_by', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    nameUnique: uniqueIndex('automation_endpoints_name_unique').on(t.name),
  }),
);
