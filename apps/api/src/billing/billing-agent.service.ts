import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { ACTION_LIMITS, addDays, colomboToday, colomboToUtc, toColombo, type AgentRunResult } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookingShifts, bookings, caregivers, invoiceLines, invoices, payoutLines, payoutStatements } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { InvoicesService, MAX_INVOICE_DAYS } from './invoices.service';
import { PayoutsService } from './payouts.service';

const ACTION = 'billing.issue_invoice' as const;
const DRAFT_PAYOUT = 'billing.draft_payout' as const;
const APPROVE_PAYOUT = 'billing.approve_payout' as const;
/** The most the agent may approve on one statement when the admin has set no limit (Settings > Automation). */
export const DEFAULT_PAYOUT_LIMIT_LKR = ACTION_LIMITS['billing.approve_payout']!.default;
/** A draft someone touched this recently is left alone: they may still be working on it. */
const SETTLED_MS = 60 * 60 * 1000;
/** Months of unpaid work a first statement may reach back over. */
const PAYOUT_MONTHS_BACK = 3;
const SWEEP_JOB = 'billing-agent.sweep';
const HOUR_MS = 60 * 60 * 1000;
/** How far back the agent looks for completed work that was never billed. */
const LOOKBACK_DAYS = 120;

/** What the agent proposes: ids, dates and money only - nothing that names a person. */
export interface InvoiceProposal extends Record<string, unknown> {
  bookingId: string;
  bookingReference: string;
  periodStart: string;
  periodEnd: string;
  lines: number;
  corrections: number;
  subtotalCents: number;
}

export interface PayoutDraftProposal extends Record<string, unknown> {
  caregiverId: string;
  caregiverRegistration: string;
  periodStart: string;
  periodEnd: string;
  lines: number;
  corrections: number;
  unpriced: number;
  totalCents: number;
}

export interface PayoutApprovalProposal extends Record<string, unknown> {
  payoutId: string;
  payoutReference: string;
  caregiverId: string;
  lines: number;
  totalCents: number;
}

const lkr = (cents: number) => `LKR ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The last day of the month before the one `today` is in. */
export function endOfPreviousMonth(today: string): string {
  return addDays(`${today.slice(0, 8)}01`, -1);
}

/** The first day of the month `months` before the one `day` is in. */
export function monthStart(day: string, months = 0): string {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * The billing agent: invoice completed work, draft caregivers' pay
 * statements, and approve the small ones.
 *
 * Paying caregivers, month by month: once a month has ended, each caregiver
 * with completed work not yet on a statement gets a draft for it
 * (`billing.draft_payout`, a reversible step). A draft that has settled - at
 * least one line, every shift priced, a total above zero and within the
 * limit - can be approved (`billing.approve_payout`, a commitment: in Auto it
 * runs alone only once it has earned that). Marking a statement paid, and
 * anything over the limit, stays with staff.
 *
 * Invoicing: see below.
 */
/**
 * Invoicing completed work.
 *
 * It follows the rule staff follow by hand. A finished booking is billed for
 * everything not yet billed; a booking still running is billed up to the end
 * of last month. What it does about it depends on the dial:
 *  - Shadow: logs what it would have billed, then scores itself once staff
 *    have billed the same work.
 *  - Assist: proposes the invoice; a staff member approves and it is created
 *    and issued under their name.
 *  - Auto: creates and issues it.
 *
 * No model is involved - this is arithmetic the invoice code already does.
 * The agent never edits prices: a shift with no rate, or an amount that has
 * changed since it was proposed, goes to staff with the reason.
 */
@Injectable()
export class BillingAgentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BillingAgentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly jobs: JobsService,
    private readonly invoicesService: InvoicesService,
    private readonly payouts: PayoutsService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(ACTION, this.issueInvoice);
    this.automation.registerExecutor(DRAFT_PAYOUT, this.draftPayout);
    this.automation.registerExecutor(APPROVE_PAYOUT, this.approvePayout);
    this.automation.registerRunner('BILLING', () => this.sweep());
    this.jobs.register(SWEEP_JOB, async () => void (await this.sweep()));
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    // One sweep an hour across all API instances: the hour is the idempotency key.
    const schedule = () =>
      void this.jobs
        .enqueue(SWEEP_JOB, {}, { uniqueKey: `${SWEEP_JOB}:${new Date().toISOString().slice(0, 13)}`, maxAttempts: 2 })
        .catch((e) => this.logger.warn(`Could not queue the billing sweep: ${(e as Error).message}`));
    this.timer = setInterval(schedule, HOUR_MS / 4);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass over the bookings with unbilled completed work - all of them, or
   * just `only`. Does nothing while Billing is Manual.
   */
  async sweep(now = new Date(), only?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(ACTION);
    const run: AgentRunResult = { function: 'BILLING', mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if (gate.mode === 'MANUAL') return run;
    run.scored = (await this.scoreShadows(only)) + (only ? 0 : await this.scorePayoutShadows());
    if (only && !only.length) return run;
    if (!only) await this.sweepPayouts(now, run);

    const today = colomboToday(now);
    const since = colomboToUtc(addDays(today, -LOOKBACK_DAYS), '00:00');
    const rows = await this.db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        startDate: bookings.startDate,
        lastShift: sql<Date>`MAX(${bookingShifts.startsAt})`,
      })
      .from(bookings)
      .innerJoin(bookingShifts, eq(bookingShifts.bookingId, bookings.id))
      .where(and(inArray(bookings.status, ['CONFIRMED', 'COMPLETED']), eq(bookingShifts.status, 'COMPLETED'), gte(bookingShifts.startsAt, since), only ? inArray(bookings.id, only) : undefined))
      .groupBy(bookings.id, bookings.reference, bookings.status, bookings.startDate);

    for (const b of rows) {
      const lastWorked = toColombo(new Date(b.lastShift)).date;
      // A finished booking is billed in full; one still running, up to the end of last month.
      const cutoff = b.status === 'COMPLETED' ? lastWorked : endOfPreviousMonth(today);
      const periodEnd = lastWorked < cutoff ? lastWorked : cutoff;
      const earliest = addDays(periodEnd, -(MAX_INVOICE_DAYS - 1));
      const periodStart = b.startDate > earliest ? b.startDate : earliest;
      if (periodStart > periodEnd) continue;
      run.considered++;
      try {
        const outcome = await this.consider({ id: b.id, reference: b.reference }, periodStart, periodEnd);
        if (outcome === 'decided') run.decided++;
        if (outcome === 'staff') run.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Billing agent: ${b.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async consider(booking: { id: string; reference: string }, periodStart: string, periodEnd: string): Promise<'nothing' | 'decided' | 'staff'> {
    const ref = { caseType: 'BOOKING' as const, caseId: booking.id };
    const preview = await this.invoicesService.previewBooking(booking.id, periodStart, periodEnd);
    if (preview.lines === 0) return 'nothing';

    if (preview.unpriced > 0 || preview.subtotalCents <= 0) {
      const why = preview.unpriced > 0 ? `${preview.unpriced} completed shift${preview.unpriced === 1 ? ' has' : 's have'} no client rate` : 'the amount comes to zero or less after corrections';
      // Only say so on a case the agent is allowed to work on.
      if ((await this.automation.gate(ACTION, ref)).outcome === 'NONE') return 'nothing';
      await this.automation.setHandoverNote(ref, {
        done: `Checked completed shifts ${periodStart} to ${periodEnd}`,
        waiting: `Staff: ${why}`,
        next: 'Will bill this booking once that is fixed',
      });
      return 'staff';
    }

    const proposal: InvoiceProposal = {
      bookingId: booking.id,
      bookingReference: booking.reference,
      periodStart,
      periodEnd,
      lines: preview.lines,
      corrections: preview.corrections,
      subtotalCents: preview.subtotalCents,
    };
    const decision = await this.automation.decide({
      action: ACTION,
      case: ref,
      reason: `${preview.lines} completed, unbilled line${preview.lines === 1 ? '' : 's'} for ${periodStart} to ${periodEnd}${preview.corrections ? ` plus ${preview.corrections} correction${preview.corrections === 1 ? '' : 's'}` : ''}: ${lkr(preview.subtotalCents)} before tax`,
      confidence: 1,
      proposal,
      dedupeKey: `${booking.id}|${periodStart}|${periodEnd}|${preview.subtotalCents}`,
    });
    if (!decision.decisionId) return 'nothing';

    if (decision.outcome === 'PROPOSE') {
      await this.automation.setHandoverNote(ref, {
        done: `Worked out an invoice for ${periodStart} to ${periodEnd}: ${lkr(preview.subtotalCents)} before tax`,
        waiting: 'Staff to approve or decline the proposal',
        next: 'Create and issue the invoice once approved',
      });
    } else if (decision.outcome === 'EXECUTE') {
      const done = await this.automation.execute(decision.decisionId);
      if (!done.ok) {
        await this.automation.setHandoverNote(ref, {
          done: `Tried to invoice ${periodStart} to ${periodEnd}`,
          waiting: `Staff: ${done.error}`,
          next: 'Nothing more from the agent on this period',
        });
        return 'staff';
      }
    }
    return 'decided';
  }

  // --- caregiver pay statements ---------------------------------------------------

  /**
   * Drafts last month's statements, then approves the settled, small ones.
   * `caregiverIds` narrows both steps (tests, and "do this caregiver now").
   */
  async sweepPayouts(now = new Date(), run?: AgentRunResult, caregiverIds?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(DRAFT_PAYOUT);
    const result = run ?? { function: 'BILLING' as const, mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if (gate.mode === 'MANUAL') return result;
    if (!run) result.scored += await this.scorePayoutShadows(caregiverIds);

    const today = colomboToday(now);
    const periodEnd = endOfPreviousMonth(today);
    const windowStart = monthStart(periodEnd, PAYOUT_MONTHS_BACK - 1);
    const workers = await this.db
      .selectDistinct({ id: caregivers.id, registrationNumber: caregivers.registrationNumber })
      .from(bookingShifts)
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(
        and(
          eq(bookingShifts.status, 'COMPLETED'),
          gte(bookingShifts.startsAt, colomboToUtc(windowStart, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(periodEnd, 1), '00:00')),
          isNull(caregivers.deletedAt),
          caregiverIds ? inArray(caregivers.id, caregiverIds.length ? caregiverIds : ['']) : undefined,
        ),
      );
    for (const cg of workers) {
      result.considered++;
      try {
        if (await this.considerDraft(cg, windowStart, periodEnd)) result.decided++;
      } catch (err) {
        this.logger.warn(`Billing agent: payout for ${cg.registrationNumber} skipped - ${(err as Error).message}`);
      }
    }

    const drafts = await this.db
      .select()
      .from(payoutStatements)
      .where(and(eq(payoutStatements.status, 'DRAFT'), caregiverIds ? inArray(payoutStatements.caregiverId, caregiverIds.length ? caregiverIds : ['']) : undefined))
      .limit(500);
    const agentUser = (await this.automation.agentActor('BILLING')).userId;
    for (const draft of drafts) {
      // Someone may still be editing a draft they touched within the hour. The agent's own drafts need no wait.
      if (draft.createdByUserId !== agentUser && now.getTime() - new Date(draft.updatedAt).getTime() < SETTLED_MS) continue;
      result.considered++;
      try {
        const outcome = await this.considerApproval(draft);
        if (outcome === 'decided') result.decided++;
        if (outcome === 'staff') result.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Billing agent: statement ${draft.reference} skipped - ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async considerDraft(cg: { id: string; registrationNumber: string }, windowStart: string, periodEnd: string): Promise<boolean> {
    const preview = await this.payouts.previewCaregiver(cg.id, windowStart, periodEnd);
    if (preview.lines === 0 || preview.totalCents <= 0) return false;
    // The statement starts with the month the oldest unpaid work was done in, not three months back.
    const periodStart = preview.earliest ? monthStart(preview.earliest) : windowStart;
    const proposal: PayoutDraftProposal = {
      caregiverId: cg.id,
      caregiverRegistration: cg.registrationNumber,
      periodStart,
      periodEnd,
      lines: preview.lines,
      corrections: preview.corrections,
      unpriced: preview.unpriced,
      totalCents: preview.totalCents,
    };
    const decision = await this.automation.decide({
      action: DRAFT_PAYOUT,
      reason:
        `${cg.registrationNumber}: ${preview.lines} completed line${preview.lines === 1 ? '' : 's'} not yet on a statement, ${periodStart} to ${periodEnd}: ${lkr(preview.totalCents)}` +
        (preview.unpriced ? ` (${preview.unpriced} with no pay rate, to be set on the draft)` : ''),
      confidence: 1,
      proposal,
      dedupeKey: `${cg.id}|${periodStart}|${periodEnd}|${preview.totalCents}`,
    });
    if (!decision.decisionId) return false;
    if (decision.outcome === 'EXECUTE') await this.automation.execute(decision.decisionId);
    return true;
  }

  /** Creates the draft statement - the same call as "New statement" on the Payouts page. */
  private readonly draftPayout: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as PayoutDraftProposal | null;
    if (!p?.caregiverId) throw new BadRequestException('This proposal has no caregiver to pay');
    const fresh = await this.payouts.previewCaregiver(p.caregiverId, p.periodStart, p.periodEnd);
    if (fresh.lines === 0) throw new BadRequestException('This work is already on a statement');
    if (fresh.totalCents !== p.totalCents) {
      throw new BadRequestException(`The amount has changed since this was proposed (${lkr(p.totalCents)} then, ${lkr(fresh.totalCents)} now). Make the statement by hand, or wait for a new proposal`);
    }
    const who = { userId: actor.userId, email: actor.email, role: actor.role };
    const draft = await this.payouts.create({ caregiverId: p.caregiverId, periodStart: p.periodStart, periodEnd: p.periodEnd }, who);
    await this.automation.setHandoverNote(
      { caseType: 'PAYOUT', caseId: draft.id },
      {
        done: `Drafted statement ${draft.reference} for ${p.periodStart} to ${p.periodEnd}: ${lkr(p.totalCents)}`,
        waiting: fresh.unpriced ? `Staff: ${fresh.unpriced} shift${fresh.unpriced === 1 ? ' has' : 's have'} no pay rate` : 'Approval',
        next: fresh.unpriced ? 'Will look again once every shift has a pay rate' : 'Approve it, if it is within the limit and the agent is allowed to',
      },
    );
    return { payoutId: draft.id, reference: draft.reference, total: draft.total };
  };

  /** The most the agent may approve on one statement, in cents. */
  private async payoutLimitCents(): Promise<number> {
    const limits = (await this.automation.gate(APPROVE_PAYOUT)).limits;
    const lkrLimit = typeof limits?.maxAmount === 'number' ? limits.maxAmount : DEFAULT_PAYOUT_LIMIT_LKR;
    return Math.round(lkrLimit * 100);
  }

  private async considerApproval(draft: typeof payoutStatements.$inferSelect): Promise<'nothing' | 'decided' | 'staff'> {
    const ref = { caseType: 'PAYOUT' as const, caseId: draft.id };
    const lines = await this.db.select({ kind: payoutLines.kind, unitPrice: payoutLines.unitPrice }).from(payoutLines).where(eq(payoutLines.statementId, draft.id));
    const totalCents = Math.round(Number(draft.total) * 100);
    if (!lines.length || totalCents <= 0) return 'nothing';
    const gate = await this.automation.gate(APPROVE_PAYOUT, ref);
    if (gate.outcome === 'NONE') return 'nothing';

    const unpriced = lines.filter((l) => l.kind === 'SHIFT' && Number(l.unitPrice) === 0).length;
    const limitCents = await this.payoutLimitCents();
    const blocker = unpriced ? `${unpriced} shift${unpriced === 1 ? ' has' : 's have'} no pay rate` : totalCents > limitCents ? `${lkr(totalCents)} is over the agent's limit of ${lkr(limitCents)}` : null;
    if (blocker) {
      if (gate.outcome !== 'SHADOW') {
        await this.automation.setHandoverNote(ref, { done: `Checked statement ${draft.reference}`, waiting: `Staff: ${blocker}`, next: 'Nothing more from the agent on this statement' });
      }
      return 'staff';
    }

    const proposal: PayoutApprovalProposal = { payoutId: draft.id, payoutReference: draft.reference, caregiverId: draft.caregiverId, lines: lines.length, totalCents };
    const decision = await this.automation.decide({
      action: APPROVE_PAYOUT,
      case: ref,
      reason: `Statement ${draft.reference}: ${lines.length} line${lines.length === 1 ? '' : 's'}, every shift priced, ${lkr(totalCents)} is within the limit of ${lkr(limitCents)}`,
      confidence: 1,
      proposal,
      dedupeKey: `${draft.id}|${totalCents}`,
    });
    if (!decision.decisionId) return 'nothing';
    if (decision.outcome === 'PROPOSE') {
      await this.automation.setHandoverNote(ref, { done: `Checked statement ${draft.reference}: ${lkr(totalCents)}`, waiting: 'Staff to approve or decline the proposal', next: 'Approve the statement once that is agreed' });
    } else if (decision.outcome === 'EXECUTE') {
      const done = await this.automation.execute(decision.decisionId);
      if (!done.ok) {
        await this.automation.setHandoverNote(ref, { done: `Tried to approve statement ${draft.reference}`, waiting: `Staff: ${done.error}`, next: 'Nothing more from the agent on this statement' });
        return 'staff';
      }
    }
    return 'decided';
  }

  /** Approves the statement - the same call as the Approve button. Paying it stays with staff. */
  private readonly approvePayout: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as PayoutApprovalProposal | null;
    if (!p?.payoutId) throw new BadRequestException('This proposal has no statement to approve');
    const statement = await this.payouts.findOne(p.payoutId);
    if (statement.status !== 'DRAFT') throw new BadRequestException('This statement is no longer a draft');
    if (statement.unpricedLines > 0) throw new BadRequestException('A shift on this statement has no pay rate');
    const nowCents = Math.round(Number(statement.total) * 100);
    if (nowCents !== p.totalCents) throw new BadRequestException(`The statement has changed since this was proposed (${lkr(p.totalCents)} then, ${lkr(nowCents)} now)`);
    if (nowCents > (await this.payoutLimitCents())) throw new BadRequestException("This statement is over the agent's limit. Approve it on the Payouts page");
    const approved = await this.payouts.approve(p.payoutId, { userId: actor.userId, email: actor.email, role: actor.role });
    await this.automation.setHandoverNote(
      { caseType: 'PAYOUT', caseId: p.payoutId },
      { done: `Statement ${approved.reference} approved: ${lkr(nowCents)}`, waiting: 'Staff to pay it and mark it paid', next: 'Nothing more from the agent on this statement' },
    );
    return { payoutId: approved.id, reference: approved.reference, total: approved.total };
  };

  /**
   * Scores the Shadow decisions about pay against what staff did.
   *  - A draft: once that work is all on statements, the totals of the
   *    statements staff made for the caregiver since are compared.
   *  - An approval: agreed if staff approved the statement at the same total;
   *    differed if they changed it first or voided it. A draft still waits.
   */
  async scorePayoutShadows(caregiverIds?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(and(inArray(agentDecisions.action, [DRAFT_PAYOUT, APPROVE_PAYOUT]), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict)))
      .limit(400);
    const fallbackReviewer = (await this.automation.agentActor('BILLING')).userId;
    let scored = 0;
    for (const d of open) {
      const caregiverId = (d.proposal as { caregiverId?: string } | null)?.caregiverId;
      if (!caregiverId || (caregiverIds && !caregiverIds.includes(caregiverId))) continue;

      if (d.action === DRAFT_PAYOUT) {
        const p = d.proposal as PayoutDraftProposal;
        const left = await this.payouts.previewCaregiver(p.caregiverId, p.periodStart, p.periodEnd).catch(() => null);
        if (!left || left.lines > 0) continue; // not all on a statement yet
        const made = await this.db
          .select()
          .from(payoutStatements)
          .where(
            and(
              eq(payoutStatements.caregiverId, p.caregiverId),
              ne(payoutStatements.status, 'VOID'),
              gt(payoutStatements.createdAt, new Date(d.createdAt.getTime() - 1000)),
              or(lt(payoutStatements.periodStart, addDays(p.periodEnd, 1)), isNull(payoutStatements.periodStart)),
            ),
          );
        if (!made.length) continue;
        const staffCents = made.reduce((sum, s) => sum + Math.round(Number(s.total) * 100), 0);
        const refs = made.map((s) => s.reference).join(', ');
        const agreed = staffCents === p.totalCents;
        await this.automation.review(
          d.id,
          agreed ? 'AGREED' : 'DIFFERED',
          agreed ? `Scored automatically: staff drafted the same amount (${refs})` : `Scored automatically: staff drafted ${lkr(staffCents)} (${refs}); the agent would have drafted ${lkr(p.totalCents)}`,
          made[0].createdByUserId ?? fallbackReviewer,
        );
        scored++;
      } else {
        const p = d.proposal as PayoutApprovalProposal;
        const [s] = await this.db.select().from(payoutStatements).where(eq(payoutStatements.id, p.payoutId)).limit(1);
        if (s?.status === 'DRAFT') continue;
        const staffCents = s ? Math.round(Number(s.total) * 100) : 0;
        const agreed = !!s && s.status !== 'VOID' && staffCents === p.totalCents;
        const note = !s
          ? 'Scored automatically: staff deleted the statement'
          : s.status === 'VOID'
            ? 'Scored automatically: staff voided the statement'
            : agreed
              ? 'Scored automatically: staff approved it unchanged'
              : `Scored automatically: staff approved it at ${lkr(staffCents)}, not ${lkr(p.totalCents)}`;
        await this.automation.review(d.id, agreed ? 'AGREED' : 'DIFFERED', note, s?.approvedByUserId ?? fallbackReviewer);
        scored++;
      }
    }
    return scored;
  }

  /**
   * Carries the step out: create the invoice from the booking's completed
   * shifts and issue it - the same two calls the staff pages make. Refuses,
   * leaving nothing behind, if the work was billed meanwhile or no longer
   * comes to the amount that was proposed.
   */
  private readonly issueInvoice: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as InvoiceProposal | null;
    if (!p?.bookingId) throw new BadRequestException('This proposal has no booking to bill');
    const fresh = await this.invoicesService.previewBooking(p.bookingId, p.periodStart, p.periodEnd);
    if (fresh.lines === 0) throw new BadRequestException('This work has already been billed');
    if (fresh.unpriced > 0) throw new BadRequestException('A completed shift has no client rate. Set it, then bill the booking');
    if (fresh.subtotalCents !== p.subtotalCents) {
      throw new BadRequestException(`The amount has changed since this was proposed (${lkr(p.subtotalCents)} then, ${lkr(fresh.subtotalCents)} now). Bill the booking by hand, or wait for a new proposal`);
    }
    const who = { userId: actor.userId, email: actor.email, role: actor.role };
    const draft = await this.invoicesService.create({ bookingId: p.bookingId, basis: 'COMPLETED', periodStart: p.periodStart, periodEnd: p.periodEnd }, who);
    await this.invoicesService.addNote(draft.id, 'Prepared by the billing agent', who);
    const issued = await this.invoicesService.issue(draft.id, {}, who);
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p.bookingId },
      {
        done: `Invoice ${issued.number} issued for ${p.periodStart} to ${p.periodEnd}`,
        waiting: `Client to pay by ${issued.dueDate}`,
        next: 'Nothing more from the agent on this period',
      },
    );
    return { invoiceId: issued.id, number: issued.number, total: issued.total };
  };

  /**
   * Shadow decisions are scored against what staff then did. Once the work
   * the agent would have billed is all on issued invoices, the amounts are
   * compared: the same to the cent is agreement, anything else is not.
   * Until staff have billed it, the decision simply waits.
   */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, ACTION), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict), only?.length ? inArray(agentDecisions.caseId, only) : undefined))
      .limit(200);
    let scored = 0;
    for (const d of open) {
      const p = d.proposal as InvoiceProposal | null;
      if (!p?.bookingId) continue;
      const left = await this.invoicesService.previewBooking(p.bookingId, p.periodStart, p.periodEnd).catch(() => null);
      if (!left || left.lines > 0) continue; // staff have not finished billing it yet

      // A booking's own invoice is compared in full (staff may have added a charge or a discount);
      // on an invoice covering several bookings only this booking's lines can be compared.
      const billed = await this.db
        .select({
          number: invoices.number,
          issuedBy: invoices.issuedByUserId,
          invoiceBookingId: invoices.bookingId,
          subtotal: invoices.subtotal,
          bookingLines: sql<string>`SUM(${invoiceLines.amount})`,
        })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(eq(invoiceLines.bookingId, p.bookingId), ne(invoices.status, 'VOID'), ne(invoices.status, 'DRAFT'), gt(invoices.issuedAt, new Date(d.createdAt.getTime() - 1000))))
        // issued_at is kept to the second and the decision to the millisecond: allow for the rounding.
        .groupBy(invoices.id, invoices.number, invoices.issuedByUserId, invoices.bookingId, invoices.subtotal);
      if (!billed.length) continue; // still in a draft: wait for staff to issue it
      const staffCents = billed.reduce((sum, r) => sum + Math.round(Number(r.invoiceBookingId === p.bookingId ? r.subtotal : r.bookingLines) * 100), 0);
      const numbers = billed.map((r) => r.number).join(', ');
      const agreed = staffCents === p.subtotalCents;
      await this.automation.review(
        d.id,
        agreed ? 'AGREED' : 'DIFFERED',
        agreed ? `Scored automatically: staff billed the same amount (${numbers})` : `Scored automatically: staff billed ${lkr(staffCents)} (${numbers}); the agent would have billed ${lkr(p.subtotalCents)}`,
        billed[0].issuedBy ?? (await this.automation.agentActor('BILLING')).userId,
      );
      scored++;
    }
    return scored;
  }
}
