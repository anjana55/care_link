import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { addDays, colomboToday, colomboToUtc, toColombo, type AgentRunResult } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookingShifts, bookings, invoiceLines, invoices } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { InvoicesService, MAX_INVOICE_DAYS } from './invoices.service';

const ACTION = 'billing.issue_invoice' as const;
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

const lkr = (cents: number) => `LKR ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The last day of the month before the one `today` is in. */
export function endOfPreviousMonth(today: string): string {
  return addDays(`${today.slice(0, 8)}01`, -1);
}

/**
 * The billing agent, first step: invoice completed work.
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
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(ACTION, this.issueInvoice);
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
    run.scored = await this.scoreShadows(only);
    if (only && !only.length) return run;

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
        .where(and(eq(invoiceLines.bookingId, p.bookingId), ne(invoices.status, 'VOID'), ne(invoices.status, 'DRAFT'), gt(invoices.issuedAt, d.createdAt)))
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
