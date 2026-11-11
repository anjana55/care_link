import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import {
  AUTOMATION_ACTIONS,
  AUTOMATION_ACTION_KEYS,
  AUTOMATION_FUNCTIONS,
  AUTOMATION_MODES,
  CASE_TYPE_FUNCTIONS,
  DECISION_OUTCOMES,
  HUMAN_ONLY_TIER,
  agreementPercent,
  effectiveMode,
  isAutomationAction,
  meetsPromotionBar,
  resolveGate,
  type ActionRecord,
  type AgentDecisionView,
  type AutomationActionKey,
  type AutomationActionStatus,
  type AutomationCaseType,
  type AutomationFunction,
  type AutomationFunctionStatus,
  type AutomationMode,
  type AutomationOverview,
  type CaseAutomationView,
  type CaseControlView,
  type CaseDriver,
  type DecisionOutcome,
  type GateOutcome,
  type HandoverNote,
  type PromotionBar,
  type RiskTier,
  type StaffVerdict,
  type TakeoverSource,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  agentDecisions,
  automationActionPolicies,
  automationCases,
  automationFunctions,
  automationSettings,
  users,
} from '../database/schema';
import { EmailService } from '../email/email.service';
import { AutomationEndpointsService } from './automation-endpoints.service';

const SETTINGS_ID = 'default';
const DAY_MS = 24 * 60 * 60 * 1000;

type SettingsRow = typeof automationSettings.$inferSelect;
type FunctionRow = typeof automationFunctions.$inferSelect;
type PolicyRow = typeof automationActionPolicies.$inferSelect;
type CaseRow = typeof automationCases.$inferSelect;
type DecisionRow = typeof agentDecisions.$inferSelect;

export interface CaseRef {
  caseType: AutomationCaseType;
  caseId: string;
}

/** What an agent is told when it asks whether it may take an action. */
export interface GateResult {
  outcome: GateOutcome;
  action: AutomationActionKey;
  function: AutomationFunction;
  tier: RiskTier;
  /** The function's dial as it applies right now. */
  mode: AutomationMode;
  /** Admin limits for this action, if any were set. */
  limits: Record<string, number> | null;
}

export interface RecordDecisionInput {
  action: AutomationActionKey;
  case?: CaseRef;
  /** One plain line: why. */
  reason: string;
  confidence?: number | null;
  /** What the agent wants to do, as masked data: ids and references only. */
  proposal?: Record<string, unknown> | null;
  model?: string | null;
  promptVersion?: string | null;
}

/**
 * The rail every agent runs on: the dials, the risk gate, the four switches
 * back to manual, who is driving each case, and the log of every decision.
 *
 * Nothing here calls a model or changes a booking. Agents ask `gate()` before
 * every action and write what they decided with `decide()`; the action itself
 * goes through the same services the staff pages use.
 *
 * Settings are read on every call rather than cached, like the other
 * settings, so a switch thrown in an incident applies at once on every API
 * instance. And everything defaults to Manual: with no rows at all, `gate()`
 * answers NONE to everything.
 */
@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly endpoints: AutomationEndpointsService,
    @Optional() private readonly email?: EmailService,
  ) {}

  /**
   * AUTOMATION_ENABLED=false in the API's env: a switch that works even when
   * the staff app or the settings row cannot be reached. Everything is Manual.
   */
  disabledByServer(): boolean {
    return this.config.get<string>('AUTOMATION_ENABLED') === 'false';
  }

  // --- settings ----------------------------------------------------------------

  private async settingsRow(): Promise<SettingsRow> {
    const [existing] = await this.db.select().from(automationSettings).where(eq(automationSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(automationSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(automationSettings).where(eq(automationSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private barOf(row: SettingsRow): PromotionBar {
    return {
      cases: row.promotionCases,
      agreementPercent: row.promotionAgreementPercent,
      demoteAfterReversals: row.demoteAfterReversals,
    };
  }

  async updateBar(patch: Partial<PromotionBar>, userId: string): Promise<AutomationOverview> {
    await this.settingsRow();
    await this.db
      .update(automationSettings)
      .set({
        ...(patch.cases !== undefined && { promotionCases: patch.cases }),
        ...(patch.agreementPercent !== undefined && { promotionAgreementPercent: patch.agreementPercent }),
        ...(patch.demoteAfterReversals !== undefined && { demoteAfterReversals: patch.demoteAfterReversals }),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(automationSettings.id, SETTINGS_ID));
    return this.overview();
  }

  // --- the master switch ---------------------------------------------------------

  /**
   * On: every function runs as Manual at once. The dials are not touched, so
   * switching it off puts each function back where it was. Nothing in flight
   * is cancelled either way.
   */
  async setMaster(on: boolean, reason: string | null, userId: string): Promise<AutomationOverview> {
    await this.settingsRow();
    await this.db
      .update(automationSettings)
      .set({
        masterManual: on,
        masterReason: on ? reason : null,
        masterAt: on ? new Date() : null,
        masterBy: on ? userId : null,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(automationSettings.id, SETTINGS_ID));
    this.logger.warn(`Automation master switch ${on ? 'ON - everything is manual' : 'off'} (by ${userId})${reason ? `: ${reason}` : ''}`);
    return this.overview();
  }

  // --- the dial per function -----------------------------------------------------

  private async functionRow(key: AutomationFunction): Promise<FunctionRow | null> {
    const [row] = await this.db.select().from(automationFunctions).where(eq(automationFunctions.key, key)).limit(1);
    return row ?? null;
  }

  private async upsertFunction(key: AutomationFunction, set: Partial<typeof automationFunctions.$inferInsert>) {
    await this.db
      .insert(automationFunctions)
      .values({ key, ...set })
      .onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
  }

  async setMode(key: AutomationFunction, mode: AutomationMode, userId: string): Promise<AutomationOverview> {
    const row = await this.functionRow(key);
    if (row?.trippedAt && mode !== 'MANUAL') {
      throw new BadRequestException('This function has tripped. Reset it before moving its dial.');
    }
    await this.upsertFunction(key, { mode, updatedBy: userId });
    return this.overview();
  }

  /** The model this agent uses and the one it falls back to. */
  async functionEndpoints(key: AutomationFunction): Promise<{ endpointId: string | null; fallbackEndpointId: string | null }> {
    const row = await this.functionRow(key);
    return { endpointId: row?.endpointId ?? null, fallbackEndpointId: row?.fallbackEndpointId ?? null };
  }

  /** Points an agent at its AI models. null clears a choice. */
  async setFunctionEndpoints(
    key: AutomationFunction,
    patch: { endpointId?: string | null; fallbackEndpointId?: string | null },
    userId: string,
  ): Promise<AutomationOverview> {
    for (const id of [patch.endpointId, patch.fallbackEndpointId]) {
      if (id && !(await this.endpoints.exists(id))) throw new BadRequestException('That AI model no longer exists');
    }
    const current = await this.functionEndpoints(key);
    const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
    if (next.endpointId && next.endpointId === next.fallbackEndpointId) {
      throw new BadRequestException('Choose a different model as the backup');
    }
    await this.upsertFunction(key, { endpointId: next.endpointId, fallbackEndpointId: next.fallbackEndpointId, updatedBy: userId });
    return this.overview();
  }

  /**
   * The automatic switch: the function runs as Manual from now until an admin
   * resets it. Safe to call repeatedly - the first reason is kept, and staff
   * are alerted once.
   */
  async trip(key: AutomationFunction, reason: string): Promise<void> {
    const row = await this.functionRow(key);
    if (row?.trippedAt) return;
    await this.upsertFunction(key, { trippedAt: new Date(), tripReason: reason.slice(0, 500) });
    this.logger.error(`Automation TRIPPED: ${key} is now manual - ${reason}`);
    await this.alertAdmins(key, reason).catch((e) => this.logger.warn(`Trip alert for ${key} not sent: ${(e as Error).message}`));
  }

  /** Clears a trip. The dial goes back to where it was, or to `mode` if one is given. */
  async resetTrip(key: AutomationFunction, userId: string, mode?: AutomationMode): Promise<AutomationOverview> {
    const row = await this.functionRow(key);
    if (!row?.trippedAt) throw new BadRequestException('This function has not tripped.');
    await this.upsertFunction(key, { trippedAt: null, tripReason: null, updatedBy: userId, ...(mode && { mode }) });
    return this.overview();
  }

  private async alertAdmins(key: AutomationFunction, reason: string) {
    if (!this.email) return;
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNotNull(users.email)));
    const to = rows.map((r) => r.email!).filter(Boolean);
    if (!to.length) return;
    const name = key.replace(/_/g, ' ').toLowerCase();
    await this.email.sendNotificationEmail(
      to,
      {
        subject: `Automation stopped: ${name} is now manual`,
        blocks: [
          {
            lang: 'en',
            heading: `The ${name} agent has stopped itself`,
            paragraphs: [
              `Reason: ${reason}`,
              'Nothing was cancelled. Its open cases are in the usual staff queues, each with a handover note.',
              'It stays manual until an admin resets it in Settings > Automation.',
            ],
          },
        ],
      },
      `automation trip ${key}`,
    );
  }

  // --- per-action permission -----------------------------------------------------

  private async policyRows(): Promise<Map<string, PolicyRow>> {
    const rows = await this.db.select().from(automationActionPolicies);
    return new Map(rows.map((r) => [r.action, r]));
  }

  private async policyRow(action: AutomationActionKey): Promise<PolicyRow | null> {
    const [row] = await this.db.select().from(automationActionPolicies).where(eq(automationActionPolicies.action, action)).limit(1);
    return row ?? null;
  }

  private async upsertPolicy(action: AutomationActionKey, set: Partial<typeof automationActionPolicies.$inferInsert>) {
    await this.db
      .insert(automationActionPolicies)
      .values({ action, ...set })
      .onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
  }

  /** The action's record against staff, over judged decisions since its record was last reset. */
  private async recordFor(action: AutomationActionKey, since: Date | null): Promise<ActionRecord> {
    const conditions: SQL[] = [eq(agentDecisions.action, action), isNotNull(agentDecisions.staffVerdict)];
    if (since) conditions.push(gt(agentDecisions.createdAt, since));
    const rows = await this.db
      .select({ verdict: agentDecisions.staffVerdict, n: sql<number>`COUNT(*)` })
      .from(agentDecisions)
      .where(and(...conditions))
      .groupBy(agentDecisions.staffVerdict);
    const record: ActionRecord = { judged: 0, agreed: 0, serious: 0 };
    for (const r of rows) {
      const n = Number(r.n);
      record.judged += n;
      if (r.verdict === 'AGREED') record.agreed += n;
      if (r.verdict === 'SERIOUS') record.serious += n;
    }
    return record;
  }

  /**
   * Lets a tier-2 action act alone in Auto, or takes that away. Switching it
   * on needs the evidence: the action's record must clear the promotion bar.
   * Tier 3 can never be switched on; tiers 0-1 have nothing to switch.
   */
  async setActionPolicy(
    action: string,
    patch: { autoAllowed?: boolean; limits?: Record<string, number> | null; resetRecord?: boolean },
    userId: string,
  ): Promise<AutomationOverview> {
    if (!isAutomationAction(action)) throw new NotFoundException('Unknown action');
    const def = AUTOMATION_ACTIONS[action];
    const existing = await this.policyRow(action);
    const set: Partial<typeof automationActionPolicies.$inferInsert> = {};

    if (patch.resetRecord) set.recordSince = new Date();

    if (patch.autoAllowed === true) {
      if (def.tier === HUMAN_ONLY_TIER) throw new BadRequestException('This action always needs a person. It cannot be automated.');
      if (def.tier !== 2) throw new BadRequestException('Only commitments (tier 2) need this permission.');
      if (patch.resetRecord) throw new BadRequestException('Resetting the record and allowing the action cannot be done together.');
      const bar = this.barOf(await this.settingsRow());
      const record = await this.recordFor(action, existing?.recordSince ?? null);
      if (!meetsPromotionBar(record, bar)) {
        throw new BadRequestException(
          `Not earned yet: needs ${bar.cases} judged decisions at ${bar.agreementPercent}% agreement with no serious miss ` +
            `(has ${record.judged}, ${agreementPercent(record) ?? 0}% agreement, ${record.serious} serious).`,
        );
      }
      Object.assign(set, { autoAllowed: true, promotedAt: new Date(), promotedBy: userId });
    } else if (patch.autoAllowed === false) {
      set.autoAllowed = false;
    }

    if (patch.limits !== undefined) {
      const entries = Object.entries(patch.limits ?? {});
      if (entries.length > 20 || entries.some(([k, v]) => k.length > 40 || typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
        throw new BadRequestException('Limits must be up to 20 named numbers, zero or more.');
      }
      set.limits = patch.limits;
    }
    if (Object.keys(set).length) await this.upsertPolicy(action, set);
    return this.overview();
  }

  // --- the gate ------------------------------------------------------------------

  /**
   * "May I?" - asked by an agent before every action. Answers from the master
   * switch, the function's dial and any trip, who is driving the case, the
   * action's tier, and whether it has earned acting alone.
   */
  async gate(action: AutomationActionKey, ref?: CaseRef): Promise<GateResult> {
    const def = AUTOMATION_ACTIONS[action];
    const base = { action, function: def.function as AutomationFunction, tier: def.tier as RiskTier };
    if (this.disabledByServer()) return { ...base, outcome: 'NONE', mode: 'MANUAL', limits: null };

    const [settings, fn, policy, driver] = await Promise.all([
      this.settingsRow(),
      this.functionRow(def.function),
      this.policyRow(action),
      ref ? this.driverOf(ref) : Promise.resolve<CaseDriver | undefined>(undefined),
    ]);
    const mode = effectiveMode(fn?.mode ?? 'MANUAL', { masterManual: settings.masterManual, tripped: Boolean(fn?.trippedAt) });
    const outcome = resolveGate({ mode, tier: def.tier, autoAllowed: Boolean(policy?.autoAllowed), driver });
    return { ...base, outcome, mode, limits: policy?.limits ?? null };
  }

  /**
   * Gate and log in one step - what agents normally call. Returns the gate's
   * answer and, unless the answer was NONE, the id of the decision it logged:
   *  - SHADOW:  logged, nothing else happens.
   *  - PROPOSE: logged as PROPOSED; the caller puts it in front of staff.
   *  - EXECUTE: logged as EXECUTED; the caller now does it, through the normal services.
   */
  async decide(input: RecordDecisionInput): Promise<GateResult & { decisionId: string | null }> {
    const gate = await this.gate(input.action, input.case);
    if (gate.outcome === 'NONE') return { ...gate, decisionId: null };
    const outcome: DecisionOutcome = gate.outcome === 'SHADOW' ? 'SHADOW' : gate.outcome === 'PROPOSE' ? 'PROPOSED' : 'EXECUTED';
    const id = uuid();
    await this.db.insert(agentDecisions).values({
      id,
      function: gate.function,
      action: input.action,
      tier: gate.tier,
      caseType: input.case?.caseType ?? null,
      caseId: input.case?.caseId ?? null,
      mode: gate.mode,
      outcome,
      reason: input.reason.slice(0, 500),
      confidence: input.confidence ?? null,
      proposal: input.proposal ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      // From this process's clock, like record_since, so "since the reset" compares like with like.
      createdAt: new Date(),
    });
    return { ...gate, decisionId: id };
  }

  /**
   * What staff made of a decision: the evidence promotion runs on. A REVERSED
   * or SERIOUS verdict on an action that acts alone counts towards taking
   * that permission away again.
   */
  async review(decisionId: string, verdict: StaffVerdict, note: string | null, userId: string): Promise<AgentDecisionView> {
    const [row] = await this.db.select().from(agentDecisions).where(eq(agentDecisions.id, decisionId)).limit(1);
    if (!row) throw new NotFoundException('Decision not found');
    if (verdict === 'REVERSED' && row.outcome !== 'EXECUTED') {
      throw new BadRequestException('Only something the agent actually did can be reversed.');
    }
    const reviewedAt = new Date();
    await this.db
      .update(agentDecisions)
      .set({ staffVerdict: verdict, staffNote: note, reviewedByUserId: userId, reviewedAt })
      .where(eq(agentDecisions.id, decisionId));

    if ((verdict === 'REVERSED' || verdict === 'SERIOUS') && isAutomationAction(row.action)) {
      await this.demoteIfNeeded(row.action, verdict);
    }
    return this.toDecisionView({ ...row, staffVerdict: verdict, staffNote: note, reviewedByUserId: userId, reviewedAt });
  }

  /** One serious miss, or too many reversals in a day, and the action needs approval again. */
  private async demoteIfNeeded(action: AutomationActionKey, verdict: StaffVerdict) {
    const policy = await this.policyRow(action);
    if (!policy?.autoAllowed) return;
    let reason: string | null = null;
    if (verdict === 'SERIOUS') {
      reason = 'Staff marked a decision as a serious mistake';
    } else {
      const bar = this.barOf(await this.settingsRow());
      const [{ n }] = await this.db
        .select({ n: sql<number>`COUNT(*)` })
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.action, action),
            eq(agentDecisions.staffVerdict, 'REVERSED'),
            gte(agentDecisions.reviewedAt, new Date(Date.now() - DAY_MS)),
          ),
        );
      if (Number(n) >= bar.demoteAfterReversals) reason = `Staff reversed it ${Number(n)} times in a day`;
    }
    if (!reason) return;
    const now = new Date();
    await this.upsertPolicy(action, { autoAllowed: false, demotedAt: now, demoteReason: reason, recordSince: now });
    this.logger.warn(`Automation: ${action} needs approval again - ${reason}`);
  }

  // --- who drives a case ---------------------------------------------------------

  private async caseRow(ref: CaseRef): Promise<CaseRow | null> {
    const [row] = await this.db
      .select()
      .from(automationCases)
      .where(and(eq(automationCases.caseType, ref.caseType), eq(automationCases.caseId, ref.caseId)))
      .limit(1);
    return row ?? null;
  }

  private async driverOf(ref: CaseRef): Promise<CaseDriver> {
    return (await this.caseRow(ref))?.driver ?? 'AGENT';
  }

  private async upsertCase(ref: CaseRef, set: Partial<typeof automationCases.$inferInsert>) {
    await this.db
      .insert(automationCases)
      .values({ id: uuid(), caseType: ref.caseType, caseId: ref.caseId, ...set })
      .onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
  }

  private async toCaseView(ref: CaseRef, row: CaseRow | null): Promise<CaseControlView> {
    let takenOverByName: string | null = null;
    if (row?.driver === 'STAFF' && row.takenOverByUserId) {
      const [user] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, row.takenOverByUserId)).limit(1);
      takenOverByName = user?.fullName ?? null;
    }
    return {
      caseType: ref.caseType,
      caseId: ref.caseId,
      driver: row?.driver ?? 'AGENT',
      takenOverAt: row?.takenOverAt?.toISOString() ?? null,
      takenOverByUserId: row?.takenOverByUserId ?? null,
      takenOverByName,
      takeoverSource: row?.takeoverSource ?? null,
      takeoverReason: row?.takeoverReason ?? null,
      handoverNote: row?.handoverNote ?? null,
      handoverNoteAt: row?.handoverNoteAt?.toISOString() ?? null,
    };
  }

  async caseControl(ref: CaseRef): Promise<CaseControlView> {
    return this.toCaseView(ref, await this.caseRow(ref));
  }

  /**
   * What a case page shows: who is driving, the handover note, whether an
   * agent for this kind of record is switched on, and its latest decisions.
   */
  async caseAutomation(ref: CaseRef): Promise<CaseAutomationView> {
    const keys = CASE_TYPE_FUNCTIONS[ref.caseType];
    const [control, settings, rows, decisions] = await Promise.all([
      this.caseControl(ref),
      this.settingsRow(),
      this.db.select().from(automationFunctions).where(inArray(automationFunctions.key, [...keys])),
      this.decisions({ caseType: ref.caseType, caseId: ref.caseId, page: 1, pageSize: 20 }),
    ]);
    let mode: AutomationMode = 'MANUAL';
    if (!this.disabledByServer()) {
      for (const row of rows) {
        const m = effectiveMode(row.mode, { masterManual: settings.masterManual, tripped: Boolean(row.trippedAt) });
        if (AUTOMATION_MODES.indexOf(m) > AUTOMATION_MODES.indexOf(mode)) mode = m;
      }
    }
    return { ...control, agentActive: mode !== 'MANUAL', mode, decisions };
  }

  /**
   * "Take over": the agent stops on this one case; everything else carries
   * on. The handover note stays, so the person reads where things stand.
   */
  async takeOver(ref: CaseRef, by: { userId: string; source: TakeoverSource; reason?: string | null }): Promise<CaseControlView> {
    await this.upsertCase(ref, {
      driver: 'STAFF',
      takenOverAt: new Date(),
      takenOverByUserId: by.userId,
      takeoverSource: by.source,
      takeoverReason: by.reason?.slice(0, 500) ?? null,
    });
    return this.caseControl(ref);
  }

  /** "Hand back": the agent may pick the case up again, if the function's dial allows. */
  async handBack(ref: CaseRef): Promise<CaseControlView> {
    const row = await this.caseRow(ref);
    if (row?.driver !== 'STAFF') throw new BadRequestException('This case has not been taken over.');
    await this.upsertCase(ref, { driver: 'AGENT', takenOverAt: null, takenOverByUserId: null, takeoverSource: null, takeoverReason: null });
    return this.caseControl(ref);
  }

  /** Written by the agent after each step on a case it drives. Never changes the driver. */
  async setHandoverNote(ref: CaseRef, note: HandoverNote): Promise<void> {
    await this.upsertCase(ref, { handoverNote: note, handoverNoteAt: new Date() });
  }

  // --- reading -------------------------------------------------------------------

  private toDecisionView(row: DecisionRow): AgentDecisionView {
    const known = isAutomationAction(row.action);
    return {
      id: row.id,
      function: row.function,
      action: row.action as AutomationActionKey,
      actionLabel: known ? AUTOMATION_ACTIONS[row.action as AutomationActionKey].label : row.action,
      tier: row.tier as RiskTier,
      caseType: row.caseType,
      caseId: row.caseId,
      mode: row.mode,
      outcome: row.outcome,
      reason: row.reason,
      confidence: row.confidence ?? null,
      proposal: row.proposal ?? null,
      model: row.model,
      staffVerdict: row.staffVerdict,
      staffNote: row.staffNote,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async decisions(filter: {
    function?: AutomationFunction;
    caseType?: AutomationCaseType;
    caseId?: string;
    awaitingStaff?: boolean;
    page: number;
    pageSize: number;
  }): Promise<AgentDecisionView[]> {
    const conditions: SQL[] = [];
    if (filter.function) conditions.push(eq(agentDecisions.function, filter.function));
    if (filter.caseType) conditions.push(eq(agentDecisions.caseType, filter.caseType));
    if (filter.caseId) conditions.push(eq(agentDecisions.caseId, filter.caseId));
    if (filter.awaitingStaff) conditions.push(eq(agentDecisions.outcome, 'PROPOSED'), isNull(agentDecisions.staffVerdict));
    const rows = await this.db
      .select()
      .from(agentDecisions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(agentDecisions.createdAt))
      .limit(filter.pageSize)
      .offset((filter.page - 1) * filter.pageSize);
    return rows.map((r) => this.toDecisionView(r));
  }

  /** Everything the Automation page shows. */
  async overview(): Promise<AutomationOverview> {
    const settings = await this.settingsRow();
    const bar = this.barOf(settings);
    const disabledByServer = this.disabledByServer();
    const weekAgo = new Date(Date.now() - 7 * DAY_MS);

    const [endpoints, functionRows, policies, recentRows, awaitingRows, takenOverRows, verdictRows] = await Promise.all([
      this.endpoints.list(),
      this.db.select().from(automationFunctions),
      this.policyRows(),
      this.db
        .select({ function: agentDecisions.function, outcome: agentDecisions.outcome, n: sql<number>`COUNT(*)` })
        .from(agentDecisions)
        .where(gte(agentDecisions.createdAt, weekAgo))
        .groupBy(agentDecisions.function, agentDecisions.outcome),
      this.db
        .select({ function: agentDecisions.function, n: sql<number>`COUNT(*)` })
        .from(agentDecisions)
        .where(and(eq(agentDecisions.outcome, 'PROPOSED'), isNull(agentDecisions.staffVerdict)))
        .groupBy(agentDecisions.function),
      this.db
        .select({ caseType: automationCases.caseType, n: sql<number>`COUNT(*)` })
        .from(automationCases)
        .where(eq(automationCases.driver, 'STAFF'))
        .groupBy(automationCases.caseType),
      this.db
        .select({ action: agentDecisions.action, verdict: agentDecisions.staffVerdict, createdAt: agentDecisions.createdAt })
        .from(agentDecisions)
        .where(and(isNotNull(agentDecisions.staffVerdict), inArray(agentDecisions.action, AUTOMATION_ACTION_KEYS))),
    ]);

    // Each action's record, counted from its own record_since.
    const records = new Map<string, ActionRecord>();
    for (const v of verdictRows) {
      const since = policies.get(v.action)?.recordSince;
      if (since && v.createdAt <= since) continue;
      const record = records.get(v.action) ?? { judged: 0, agreed: 0, serious: 0 };
      record.judged += 1;
      if (v.verdict === 'AGREED') record.agreed += 1;
      if (v.verdict === 'SERIOUS') record.serious += 1;
      records.set(v.action, record);
    }

    const byKey = new Map(functionRows.map((r) => [r.key, r]));
    const casesTakenOver = takenOverRows.reduce((sum, r) => sum + Number(r.n), 0);

    const functions: AutomationFunctionStatus[] = AUTOMATION_FUNCTIONS.map((key) => {
      const row = byKey.get(key);
      const mode: AutomationMode = row?.mode ?? 'MANUAL';
      const recent = Object.fromEntries(DECISION_OUTCOMES.map((o) => [o, 0])) as Record<DecisionOutcome, number>;
      for (const r of recentRows) if (r.function === key) recent[r.outcome] = Number(r.n);

      const actions: AutomationActionStatus[] = AUTOMATION_ACTION_KEYS.filter((a) => AUTOMATION_ACTIONS[a].function === key).map((a) => {
        const def = AUTOMATION_ACTIONS[a];
        const policy = policies.get(a);
        const record = records.get(a) ?? { judged: 0, agreed: 0, serious: 0 };
        return {
          key: a,
          function: def.function,
          tier: def.tier,
          label: def.label,
          autoAllowed: def.tier === 2 && Boolean(policy?.autoAllowed),
          record,
          agreementPercent: agreementPercent(record),
          eligibleForAuto: def.tier === 2 && meetsPromotionBar(record, bar),
          promotedAt: policy?.promotedAt?.toISOString() ?? null,
          demotedAt: policy?.demotedAt?.toISOString() ?? null,
        };
      });

      return {
        key,
        mode,
        effectiveMode: disabledByServer ? 'MANUAL' : effectiveMode(mode, { masterManual: settings.masterManual, tripped: Boolean(row?.trippedAt) }),
        trippedAt: row?.trippedAt?.toISOString() ?? null,
        tripReason: row?.tripReason ?? null,
        endpointId: row?.endpointId ?? null,
        fallbackEndpointId: row?.fallbackEndpointId ?? null,
        actions,
        recent,
        awaitingStaff: Number(awaitingRows.find((r) => r.function === key)?.n ?? 0),
      };
    });

    return {
      disabledByServer,
      masterManual: settings.masterManual,
      masterReason: settings.masterReason,
      masterAt: settings.masterAt?.toISOString() ?? null,
      bar,
      casesTakenOver,
      endpoints,
      functions,
    };
  }
}
