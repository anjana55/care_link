import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { PUBLIC_CAREGIVER_STATUSES, toColombo, type AgentRunResult, type BookingStandby } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookingEvents, bookingShifts, bookings, caregivers, shiftCheckins } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { BookingAgentService } from '../bookings/booking-agent.service';
import { JobsService } from '../jobs/jobs.service';
import { nudgeLiveCare } from '../bookings/live-care-jobs';
import { EmailService } from '../email/email.service';
import { CoverService } from './cover.service';

const STANDBY = 'booking.line_up_understudy' as const;
/** Bookings with a shift this soon get a standby proposed. */
const STANDBY_HORIZON_DAYS = 14;

export interface StandbyProposal extends Record<string, unknown> {
  bookingId: string;
  bookingReference: string;
  caregiverId: string;
  registrationNumber: string;
  reasons: string[];
}

/**
 * Two ways cover starts before a visit goes wrong:
 *
 * - "I can't make this shift": the caregiver on a shift says so, any time
 *   before they check in. Staff are emailed, and the live-care agent's cover
 *   part offers the shift at once (with Live care on Manual, staff use Find
 *   cover). They can take it back while nobody has accepted; staff can clear
 *   it when they hear the caregiver can come after all. Whoever accepts the
 *   cover takes the shift, and the note goes with it.
 *
 * - A standby caregiver per booking: asked first, alone, whenever one of the
 *   booking's shifts needs cover. Set by staff, or proposed by the booking
 *   agent (`booking.line_up_understudy`, tier 1) from the matching rules for
 *   the booking's next shift. Being standby is not a promise: they are asked
 *   like anyone else, and can say no.
 */
@Injectable()
export class ShiftDropoutsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ShiftDropoutsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly bookingAgent: BookingAgentService,
    private readonly jobs: JobsService,
    private readonly email: EmailService,
    private readonly cover: CoverService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(STANDBY, this.lineUp);
    this.bookingAgent.registerPart((now) => this.proposeStandbys(now));
  }

  // ---- "I can't make this shift" ----

  private async ownShift(user: AuthenticatedUser, shiftId: string) {
    if (!user.caregiverId) throw new NotFoundException('Shift not found');
    const [row] = await this.db
      .select({
        shiftId: bookingShifts.id,
        bookingId: bookings.id,
        reference: bookings.reference,
        bookingStatus: bookings.status,
        status: bookingShifts.status,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        caregiverId: bookingShifts.caregiverId,
        cantMakeAt: bookingShifts.cantMakeAt,
        registration: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        checkedInAt: shiftCheckins.checkedInAt,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .leftJoin(shiftCheckins, eq(shiftCheckins.shiftId, bookingShifts.id))
      .where(eq(bookingShifts.id, shiftId))
      .limit(1);
    // Someone else's shift answers as one that does not exist.
    if (!row || row.caregiverId !== user.caregiverId) throw new NotFoundException('Shift not found');
    return row;
  }

  async cantMake(user: AuthenticatedUser, shiftId: string, note: string | undefined, now = new Date()): Promise<{ ok: true }> {
    const row = await this.ownShift(user, shiftId);
    if (row.bookingStatus !== 'CONFIRMED' || row.status !== 'SCHEDULED') throw new BadRequestException('This shift is not going ahead');
    if (new Date(row.endsAt).getTime() <= now.getTime()) throw new BadRequestException('This shift is already over');
    if (row.checkedInAt) throw new BadRequestException('You have checked in for this shift - please call the office');
    if (row.cantMakeAt) return { ok: true };
    const clean = note?.trim() || null;
    await this.db
      .update(bookingShifts)
      .set({ cantMakeAt: now, cantMakeNote: clean, cantMakeCaregiverId: row.caregiverId })
      .where(and(eq(bookingShifts.id, shiftId), isNull(bookingShifts.cantMakeAt)));
    const when = toColombo(row.startsAt);
    const said = `${row.registration} said they cannot make the shift on ${when.date} at ${when.time}${clean ? `: "${clean}"` : ''}`;
    await this.db.insert(bookingEvents).values({ id: uuid(), bookingId: row.bookingId, type: 'NOTE', note: said, actorUserId: user.userId });
    const agentOn = (await this.automation.gate('live_care.replace_caregiver')).mode !== 'MANUAL';
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: row.bookingId },
      { done: said, waiting: agentOn ? 'The live-care agent is offering the shift as cover' : 'Staff to find cover (Find cover on Today\'s visits)', next: 'Whoever accepts takes the shift; staff if nobody does' },
    );
    await this.tellStaff(`Can't make a shift: ${row.reference} ${when.date} ${when.time}`, [
      `${row.fullName} (${row.registration}) said they cannot make the shift on ${when.date} at ${when.time}.`,
      ...(clean ? [`Their note: "${clean}"`] : []),
      agentOn ? 'The live-care agent is offering the shift to other caregivers now - the booking\'s standby first, when it has one. You will hear when someone takes it, or if nobody does.' : 'Live care is on Manual: open Find cover for this shift to offer it to other caregivers.',
    ], row.bookingId, `cant make ${shiftId}`);
    await nudgeLiveCare(this.jobs, this.automation, shiftId);
    return { ok: true };
  }

  /** The caregiver takes it back - only while nobody has taken the shift. Waiting cover offers are withdrawn. */
  async canMakeAfterAll(shiftId: string, by: { user: AuthenticatedUser; staff: boolean }): Promise<{ ok: true }> {
    const row = by.staff ? await this.staffShift(shiftId) : await this.ownShift(by.user, shiftId);
    if (!row.cantMakeAt) return { ok: true };
    await this.db.update(bookingShifts).set({ cantMakeAt: null, cantMakeNote: null, cantMakeCaregiverId: null }).where(eq(bookingShifts.id, shiftId));
    const withdrawn = await this.cover.closeFor(shiftId);
    const when = toColombo(row.startsAt);
    await this.db.insert(bookingEvents).values({
      id: uuid(),
      bookingId: row.bookingId,
      type: 'NOTE',
      note: `${row.registration} can make the shift on ${when.date} at ${when.time} after all${by.staff ? ' (recorded by staff)' : ''}${withdrawn ? ` - ${withdrawn} cover offer${withdrawn === 1 ? '' : 's'} withdrawn` : ''}`,
      actorUserId: by.user.userId,
    });
    return { ok: true };
  }

  private async staffShift(shiftId: string) {
    const [row] = await this.db
      .select({ bookingId: bookings.id, startsAt: bookingShifts.startsAt, cantMakeAt: bookingShifts.cantMakeAt, registration: caregivers.registrationNumber })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(eq(bookingShifts.id, shiftId))
      .limit(1);
    if (!row) throw new NotFoundException('Shift not found');
    return row;
  }

  // ---- Standby caregiver ----

  /** The booking's next scheduled shift, for ranking who suits it. */
  private async nextShift(bookingId: string, now: Date) {
    const [s] = await this.db
      .select({ id: bookingShifts.id })
      .from(bookingShifts)
      .where(and(eq(bookingShifts.bookingId, bookingId), eq(bookingShifts.status, 'SCHEDULED'), gt(bookingShifts.endsAt, now)))
      .orderBy(asc(bookingShifts.startsAt))
      .limit(1);
    return s?.id ?? null;
  }

  async standby(bookingId: string, now = new Date()): Promise<BookingStandby> {
    const [b] = await this.db
      .select({ id: bookings.id, standbyId: bookings.standbyCaregiverId, setBy: bookings.standbySetBy, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber, phone: caregivers.primaryPhone })
      .from(bookings)
      .leftJoin(caregivers, eq(caregivers.id, bookings.standbyCaregiverId))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!b) throw new NotFoundException('Booking not found');
    const shiftId = await this.nextShift(bookingId, now);
    const suggestions = shiftId ? (await this.cover.forShift(shiftId, now)).suggestions.filter((s) => s.caregiverId !== b.standbyId).slice(0, 5) : [];
    return {
      bookingId,
      standby: b.standbyId && b.registrationNumber ? { caregiverId: b.standbyId, fullName: b.fullName!, registrationNumber: b.registrationNumber, phone: b.phone } : null,
      setBy: b.standbyId ? b.setBy : null,
      suggestions,
    };
  }

  async setStandby(bookingId: string, caregiverId: string | null, by: { userId: string; agent: boolean }): Promise<BookingStandby> {
    const [b] = await this.db.select({ status: bookings.status, caregiverId: bookings.caregiverId, standbyId: bookings.standbyCaregiverId }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!b) throw new NotFoundException('Booking not found');
    if (b.status === 'CANCELLED' || b.status === 'COMPLETED') throw new BadRequestException('This booking is closed');
    let reg: string | null = null;
    if (caregiverId) {
      if (caregiverId === b.caregiverId) throw new BadRequestException('The booked caregiver cannot be their own standby');
      const [cg] = await this.db.select({ reg: caregivers.registrationNumber, status: caregivers.status, userId: caregivers.userId, deletedAt: caregivers.deletedAt }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
      if (!cg || cg.deletedAt) throw new BadRequestException('Caregiver not found');
      if (!cg.userId || !(PUBLIC_CAREGIVER_STATUSES as readonly string[]).includes(cg.status)) throw new BadRequestException('This caregiver cannot be offered shifts');
      reg = cg.reg;
    }
    if (caregiverId === b.standbyId) return this.standby(bookingId);
    await this.db.update(bookings).set({ standbyCaregiverId: caregiverId, standbySetBy: caregiverId ? (by.agent ? 'AGENT' : 'STAFF') : null }).where(eq(bookings.id, bookingId));
    await this.db.insert(bookingEvents).values({
      id: uuid(),
      bookingId,
      type: 'NOTE',
      note: caregiverId ? `Standby caregiver: ${reg}${by.agent ? ' (lined up by the booking agent)' : ''}` : 'Standby caregiver removed',
      actorUserId: by.userId,
    });
    return this.standby(bookingId);
  }

  /**
   * The booking agent's standby part: confirmed bookings with a shift in the
   * next two weeks and no standby get the best fit for their next shift
   * proposed - once per booking. Shadow is scored by whom staff then choose.
   */
  async proposeStandbys(now = new Date(), only?: string[]): Promise<Pick<AgentRunResult, 'considered' | 'decided' | 'scored' | 'leftToStaff'>> {
    const out = { considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if ((await this.automation.gate(STANDBY)).mode === 'MANUAL') return out;
    out.scored = await this.scoreShadows(only);
    const soon = new Date(now.getTime() + STANDBY_HORIZON_DAYS * 86_400_000);
    const rows = await this.db
      .selectDistinct({ id: bookings.id, reference: bookings.reference })
      .from(bookings)
      .innerJoin(bookingShifts, eq(bookingShifts.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.status, 'CONFIRMED'),
          isNull(bookings.standbyCaregiverId),
          eq(bookingShifts.status, 'SCHEDULED'),
          gt(bookingShifts.endsAt, now),
          lt(bookingShifts.startsAt, soon),
          only ? inArray(bookings.id, only.length ? only : ['-']) : undefined,
        ),
      )
      .limit(200);
    for (const b of rows) {
      try {
        const ref = { caseType: 'BOOKING' as const, caseId: b.id };
        if ((await this.automation.gate(STANDBY, ref)).outcome === 'NONE') continue;
        const [seen] = await this.db.select({ id: agentDecisions.id }).from(agentDecisions).where(and(eq(agentDecisions.action, STANDBY), eq(agentDecisions.dedupeKey, `${b.id}|standby`))).limit(1);
        if (seen) continue;
        const shiftId = await this.nextShift(b.id, now);
        if (!shiftId) continue;
        const [best] = await this.cover.rank(await this.cover.shift(shiftId), now);
        if (!best) continue;
        out.considered++;
        const decision = await this.automation.decide({
          action: STANDBY,
          case: ref,
          reason: `Line up ${best.registrationNumber} as standby for ${b.reference}: the best fit for its next shift (${best.reasons.slice(0, 2).join(', ') || 'matches'})`,
          proposal: { bookingId: b.id, bookingReference: b.reference, caregiverId: best.caregiverId, registrationNumber: best.registrationNumber, reasons: best.reasons } satisfies StandbyProposal,
          dedupeKey: `${b.id}|standby`,
        });
        if (!decision.decisionId) continue;
        out.decided++;
        if (decision.outcome === 'EXECUTE') {
          const result = await this.automation.execute(decision.decisionId);
          if (!result.ok) this.logger.warn(`Standby for ${b.reference} not set - ${result.error}`);
        }
      } catch (err) {
        this.logger.warn(`Standby: ${b.reference} skipped - ${(err as Error).message}`);
      }
    }
    return out;
  }

  private readonly lineUp: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as StandbyProposal | null;
    if (!p?.bookingId || !p.caregiverId) throw new BadRequestException('This proposal has no booking');
    const [b] = await this.db.select({ standbyId: bookings.standbyCaregiverId }).from(bookings).where(eq(bookings.id, p.bookingId)).limit(1);
    if (b?.standbyId) throw new ConflictException('This booking has a standby already');
    await this.setStandby(p.bookingId, p.caregiverId, { userId: actor.userId, agent: true });
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p.bookingId },
      { done: `Lined up ${p.registrationNumber} as standby`, waiting: 'Nothing - they are asked first if a shift needs cover', next: 'Staff can change the standby on the booking' },
    );
    return { standby: p.registrationNumber };
  };

  /** Shadow standbys: scored once staff choose one - the same caregiver = agreed, another = differed. */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select({ id: agentDecisions.id, caseId: agentDecisions.caseId, proposal: agentDecisions.proposal })
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, STANDBY), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict), only ? inArray(agentDecisions.caseId, only.length ? only : ['-']) : undefined))
      .limit(300);
    if (!open.length) return 0;
    const chosen = await this.db
      .select({ id: bookings.id, standbyId: bookings.standbyCaregiverId })
      .from(bookings)
      .where(and(inArray(bookings.id, open.map((d) => d.caseId!)), eq(bookings.standbySetBy, 'STAFF')));
    const agent = (await this.automation.agentActor('BOOKING')).userId;
    let scored = 0;
    for (const d of open) {
      const c = chosen.find((x) => x.id === d.caseId);
      if (!c?.standbyId) continue;
      const same = c.standbyId === (d.proposal as StandbyProposal | null)?.caregiverId;
      await this.automation.review(d.id, same ? 'AGREED' : 'DIFFERED', same ? 'Scored automatically: staff chose the same standby' : 'Scored automatically: staff chose another standby', agent);
      scored++;
    }
    return scored;
  }

  private async tellStaff(subject: string, paragraphs: string[], bookingId: string, label: string) {
    const to = await this.cover.staffRecipients();
    if (!to.length) return;
    try {
      await this.email.sendNotificationEmail(
        to,
        { subject, blocks: [{ lang: 'en', heading: subject, paragraphs }], cta: { label: 'Open the booking', url: `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}/bookings/${bookingId}` } },
        label,
      );
    } catch (err) {
      this.logger.warn(`Staff email "${subject}" failed - ${(err as Error).message}`);
    }
  }
}
