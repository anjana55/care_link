import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { toColombo, type AgentRunResult } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookingShifts, bookings, caregivers, requestOffers, shiftCheckins } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { CheckInService } from '../bookings/check-in.service';
import { LiveCareAgentService, type VisitProposal } from '../bookings/live-care-agent.service';
import { flagReason } from '../bookings/live-care-rules';
import { CoverService } from './cover.service';
import { COVER_WAVE, coverStep } from './cover-rules';

const REPLACE = 'live_care.replace_caregiver' as const;
const FLAG = 'live_care.flag_visit' as const;

/** Who the shift would be offered to: ids, registration numbers and the rules' reasons - nobody's name or contact. */
export interface CoverProposal extends VisitProposal {
  endsAt: string;
  wave: number;
  candidates: { caregiverId: string; registrationNumber: string; score: number; reasons: string[] }[];
}

type Part = Pick<AgentRunResult, 'considered' | 'decided' | 'scored' | 'leftToStaff'>;

/**
 * The cover part of the live-care agent. When a visit has started, its
 * caregiver has been chased and still nobody has checked in, it offers the
 * shift to the three best-placed caregivers who are free, with a quarter of
 * an hour to answer. The first to accept is put on the shift; the client and
 * the caregiver who was replaced are told. If all three say no or do not
 * answer it asks the next three, then stops and tells staff nobody took it.
 *
 * Offering a shift to cover caregivers leads to a caregiver being replaced,
 * so it is a tier 2 step: in Assist, and in Auto until it has earned the
 * right, it is proposed and a staff member approves it. In Shadow it only
 * logs who it would have asked, and is scored against who staff put on the
 * shift.
 *
 * It does not look for cover when less than an hour of the visit is left.
 * A shift billed in advance is covered like any other (the change is then
 * recorded as a correction). Who is asked comes from the matching rules; no
 * model is involved.
 */
@Injectable()
export class CoverAgentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CoverAgentService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly automation: AutomationService,
    private readonly liveCare: LiveCareAgentService,
    private readonly checkIns: CheckInService,
    private readonly cover: CoverService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(REPLACE, this.replace);
    this.liveCare.registerPart((now, only) => this.sweep(now, only));
  }

  /** One pass over the visits that have started, are not over, and have nobody checked in - all, or just the shifts in `only`. */
  async sweep(now = new Date(), only?: string[]): Promise<Part> {
    const run: Part = { considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    const gate = await this.automation.gate(REPLACE);
    if (gate.mode === 'MANUAL') return run;
    const settings = await this.checkIns.settings();
    if (!settings.enabled) return run;
    run.scored = await this.scoreShadows(now, only);
    if (only && !only.length) return run;

    const rows = await this.db
      .select({
        shiftId: bookingShifts.id,
        bookingId: bookings.id,
        reference: bookings.reference,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        caregiverId: bookingShifts.caregiverId,
        registration: caregivers.registrationNumber,
        checkedInAt: shiftCheckins.checkedInAt,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .innerJoin(caregivers, eq(bookingShifts.caregiverId, caregivers.id))
      .leftJoin(shiftCheckins, eq(shiftCheckins.shiftId, bookingShifts.id))
      .where(
        and(
          eq(bookings.status, 'CONFIRMED'),
          eq(bookingShifts.status, 'SCHEDULED'),
          lt(bookingShifts.startsAt, now),
          gt(bookingShifts.endsAt, now),
          only ? inArray(bookingShifts.id, only) : undefined,
        ),
      )
      .orderBy(bookingShifts.startsAt)
      .limit(500);
    const open = rows.filter((r) => !r.checkedInAt);
    if (!open.length) return run;
    const offers = await this.db
      .select({ shiftId: requestOffers.shiftId, status: requestOffers.status, expiresAt: requestOffers.expiresAt })
      .from(requestOffers)
      .where(and(inArray(requestOffers.shiftId, open.map((r) => r.shiftId)), eq(requestOffers.kind, 'COVER')));

    for (const row of open) {
      const step = coverStep(row, settings, offers.filter((o) => o.shiftId === row.shiftId), now);
      if (step.step === 'none') continue;
      try {
        const ref = { caseType: 'BOOKING' as const, caseId: row.bookingId };
        const time = toColombo(row.startsAt).time;
        const base: VisitProposal = {
          bookingId: row.bookingId,
          bookingReference: row.reference,
          shiftId: row.shiftId,
          caregiverId: row.caregiverId,
          caregiverRegistration: row.registration,
          startsAt: new Date(row.startsAt).toISOString(),
        };
        /** Nobody to ask, or nobody took it: a person takes over. Told once per visit. */
        const giveUp = async (reason: string, asked: number) => {
          if (await this.seen(FLAG, `${row.shiftId}|NO_COVER`)) return;
          run.considered++;
          const d = await this.automation.decide({ action: FLAG, case: ref, reason, proposal: { ...base, kind: 'NO_COVER', minutes: asked }, dedupeKey: `${row.shiftId}|NO_COVER` });
          if (!d.decisionId) return;
          if (d.outcome === 'EXECUTE') {
            const result = await this.automation.execute(d.decisionId);
            if (!result.ok) return void this.logger.warn(`Cover: telling staff about ${row.reference} failed - ${result.error}`);
            run.leftToStaff++;
          }
          run.decided++;
        };

        if (step.step === 'giveUp') {
          await giveUp(flagReason('NO_COVER', { minutes: step.asked }, row.registration, time), step.asked);
          continue;
        }
        // One decision per state of the asking: a proposal nobody approved is not repeated, and each new round is its own step.
        const asked = offers.filter((o) => o.shiftId === row.shiftId).length;
        const key = `${row.shiftId}|${asked}`;
        if (await this.seen(REPLACE, key)) continue;
        const shift = await this.cover.shift(row.shiftId);
        if (this.cover.blocked(shift, now)) continue;
        const ranked = (await this.cover.rank(shift, now)).slice(0, COVER_WAVE);
        if (!ranked.length) {
          await giveUp(flagReason('NO_COVER', { minutes: asked }, row.registration, time), asked);
          continue;
        }
        run.considered++;
        const proposal: CoverProposal = {
          ...base,
          endsAt: new Date(row.endsAt).toISOString(),
          wave: step.wave,
          minutes: step.minutesLate,
          candidates: ranked.map((r) => ({ caregiverId: r.caregiverId, registrationNumber: r.registrationNumber, score: r.score, reasons: r.reasons })),
        };
        const decision = await this.automation.decide({
          action: REPLACE,
          case: ref,
          reason: `Offer the ${time} visit as cover to ${ranked.map((r) => r.registrationNumber).join(', ')}: ${row.registration} is ${step.minutesLate} min late, was asked to check in, and has not${step.wave > 1 ? ` (round ${step.wave}: nobody asked so far took it)` : ''}`,
          proposal,
          dedupeKey: key,
        });
        if (!decision.decisionId) continue;
        if (decision.outcome === 'EXECUTE') {
          const result = await this.automation.execute(decision.decisionId);
          if (!result.ok) {
            this.logger.warn(`Cover: offering ${row.reference} failed - ${result.error}`);
            continue;
          }
        }
        run.decided++;
      } catch (err) {
        this.logger.warn(`Cover: ${row.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  /** Whether this step was already logged, proposed or done - so a visit is not ranked again on every pass. */
  private async seen(action: typeof REPLACE | typeof FLAG, dedupeKey: string): Promise<boolean> {
    const [row] = await this.db.select({ id: agentDecisions.id }).from(agentDecisions).where(and(eq(agentDecisions.action, action), eq(agentDecisions.dedupeKey, dedupeKey))).limit(1);
    return Boolean(row);
  }

  /** Sends the cover offers. Run by the agent when it has earned the right, and by a staff member approving the proposal. */
  private readonly replace: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as CoverProposal | null;
    if (!p?.shiftId || !p.candidates?.length) throw new BadRequestException('This proposal has no visit');
    const shift = await this.cover.shift(p.shiftId);
    if (shift.caregiverId !== p.caregiverId) throw new BadRequestException('This shift has a different caregiver now');
    const blocked = this.cover.blocked(shift);
    if (blocked) throw new BadRequestException(blocked === 'CHECKED_IN' ? 'The caregiver has checked in since' : 'This shift can no longer be offered as cover');
    const result = await this.cover.offerTo(shift, p.candidates.map((c) => c.caregiverId), { note: null, sentByUserId: actor.userId, strict: false });
    if (!result.sent.length) throw new BadRequestException('None of these caregivers can be offered the shift any more');
    const time = toColombo(p.startsAt).time;
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p.bookingId },
      {
        done: `Offered the ${time} visit as cover to ${result.sent.length} caregiver${result.sent.length === 1 ? '' : 's'} (${p.caregiverRegistration} has not checked in)`,
        waiting: `One of them to accept by ${toColombo(result.expiresAt).time}`,
        next: 'Put the first to accept on the shift; if nobody does, ask the next caregivers, then tell staff',
      },
    );
    return { offered: result.sent.length, skipped: result.skipped.length, answerBy: result.expiresAt.toISOString() };
  };

  /**
   * "Offer as cover" logged in Shadow is scored once the visit has played
   * out: staff put one of the caregivers it named on the shift = agreed; they
   * put someone else on it, or nobody = differed.
   */
  async scoreShadows(now = new Date(), only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, REPLACE), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict), eq(agentDecisions.caseType, 'BOOKING')))
      .limit(500);
    const mine = open.filter((d) => {
      const id = (d.proposal as CoverProposal | null)?.shiftId;
      return !!id && (!only?.length || only.includes(id));
    });
    if (!mine.length) return 0;
    const shifts = await this.db
      .select({ id: bookingShifts.id, caregiverId: bookingShifts.caregiverId, status: bookingShifts.status, endsAt: bookingShifts.endsAt, by: bookingShifts.updatedByUserId })
      .from(bookingShifts)
      .where(inArray(bookingShifts.id, mine.map((d) => (d.proposal as CoverProposal).shiftId)));
    let scored = 0;
    for (const d of mine) {
      const p = d.proposal as CoverProposal;
      const shift = shifts.find((s) => s.id === p.shiftId);
      if (!shift) continue;
      const replaced = shift.caregiverId !== p.caregiverId;
      const over = shift.status !== 'SCHEDULED' || new Date(shift.endsAt).getTime() <= now.getTime();
      if (!replaced && !over) continue; // still playing out
      const named = replaced && p.candidates.some((c) => c.caregiverId === shift.caregiverId);
      await this.automation.review(
        d.id,
        named ? 'AGREED' : 'DIFFERED',
        named
          ? 'Scored automatically: staff put one of these caregivers on the shift'
          : replaced
            ? 'Scored automatically: staff put a different caregiver on the shift'
            : 'Scored automatically: no cover was arranged for this visit',
        shift.by ?? (await this.automation.agentActor('LIVE_CARE')).userId,
      );
      scored++;
    }
    return scored;
  }
}
