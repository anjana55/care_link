import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { colomboToday, type AgentRunResult } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { OPEN_CARE_REQUEST_STATUSES, agentDecisions, bookings, careRequests, caregivers, patients, requestOffers } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { BookingsService } from './bookings.service';
import { BOOKING_REQUEST_JOB, BOOKING_SWEEP_JOB } from './booking-agent-jobs';
import { draftBooking, type BookingDraft } from './booking-draft-rules';

const DRAFT = 'booking.create_draft' as const;
const SWEEP_MS = 5 * 60 * 1000;
/** Accepted offers older than this are not picked up: by then a person is dealing with them. */
const LOOKBACK_DAYS = 30;

/** What the agent proposes: ids, references and the pattern - nobody's name or contact. */
export interface DraftBookingProposal extends Record<string, unknown> {
  requestId: string;
  requestReference: string;
  offerId: string;
  caregiverId: string;
  caregiverRegistration: string;
  draft: BookingDraft;
}

type Candidate = {
  requestId: string;
  reference: string;
  offerId: string;
  caregiverId: string;
  registration: string;
  schedule: 'DAY' | 'NIGHT' | 'LIVE_IN_24H' | 'NOT_SURE' | null;
  urgency: 'IMMEDIATELY' | 'WITHIN_WEEK' | 'WITHIN_MONTH' | 'JUST_EXPLORING' | null;
  desiredStartDate: string | null;
  rateType: 'HOURLY' | 'DAILY' | 'MONTHLY' | null;
  payRate: number | null;
  clientRate: number | null;
};

/**
 * The booking agent: when a caregiver has accepted a job offer, it drafts the
 * booking so the matched request does not sit waiting for someone to type it in.
 *
 * It works only from an accepted offer - the caregiver has said yes and the
 * rates are known. The draft takes the hours the client gave when they
 * registered (day, night or live-in, at the office's usual times), starts on
 * the day they asked for and covers the first two weeks, at the rates agreed
 * in the offer. When the request does not say what hours or what start date,
 * it does not guess: the request goes to staff with the reason.
 *
 * It never confirms. A draft booking tells nobody and reserves nothing;
 * checking the times with the client and confirming stays with a person.
 *
 *  - Shadow: logs the draft it would have made, then scores itself against
 *    the booking staff make (same schedule and start date = agreed).
 *  - Assist: proposes the draft; approving creates it under the staff member.
 *  - Auto: creates the draft.
 *
 * No model is involved.
 */
@Injectable()
export class BookingAgentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BookingAgentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly jobs: JobsService,
    private readonly bookingsService: BookingsService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(DRAFT, this.createDraft);
    this.automation.registerRunner('BOOKING', () => this.sweep());
    this.jobs.register(BOOKING_SWEEP_JOB, async () => void (await this.sweep()));
    this.jobs.register(BOOKING_REQUEST_JOB, async (payload) => {
      const requestId = (payload as { requestId?: unknown }).requestId;
      if (typeof requestId === 'string') await this.sweep(new Date(), [requestId]);
    });
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    const schedule = () =>
      void this.jobs
        .enqueue(BOOKING_SWEEP_JOB, {}, { uniqueKey: `${BOOKING_SWEEP_JOB}:${Math.floor(Date.now() / SWEEP_MS)}`, maxAttempts: 2 })
        .catch((e) => this.logger.warn(`Could not queue the booking sweep: ${(e as Error).message}`));
    this.timer = setInterval(schedule, SWEEP_MS / 2);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over requests whose caregiver accepted an offer and that have no booking yet - all, or just `only`. */
  async sweep(now = new Date(), only?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(DRAFT);
    const run: AgentRunResult = { function: 'BOOKING', mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if (gate.mode === 'MANUAL') return run;
    run.scored = await this.scoreShadows(only);
    if (only && !only.length) return run;

    const rows: Candidate[] = await this.db
      .select({
        requestId: careRequests.id,
        reference: careRequests.reference,
        offerId: requestOffers.id,
        caregiverId: requestOffers.caregiverId,
        registration: caregivers.registrationNumber,
        schedule: patients.careSchedule,
        urgency: patients.careStart,
        desiredStartDate: careRequests.desiredStartDate,
        rateType: requestOffers.rateType,
        payRate: requestOffers.payRate,
        clientRate: requestOffers.clientRate,
      })
      .from(requestOffers)
      .innerJoin(careRequests, eq(careRequests.id, requestOffers.requestId))
      .innerJoin(patients, eq(patients.id, careRequests.patientId))
      .innerJoin(caregivers, eq(caregivers.id, requestOffers.caregiverId))
      .where(
        and(
          eq(requestOffers.status, 'ACCEPTED'),
          // Still the request's caregiver: staff have not swapped them since.
          eq(careRequests.caregiverId, requestOffers.caregiverId),
          inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]),
          isNull(caregivers.deletedAt),
          only ? inArray(careRequests.id, only) : gte(requestOffers.respondedAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        ),
      )
      .orderBy(requestOffers.respondedAt)
      .limit(200);
    if (!rows.length) return run;

    // A request that already has a booking (a draft counts; a cancelled one does not) is done.
    const booked = new Set(
      (
        await this.db
          .select({ id: bookings.careRequestId })
          .from(bookings)
          .where(and(inArray(bookings.careRequestId, rows.map((r) => r.requestId)), ne(bookings.status, 'CANCELLED')))
      ).map((b) => b.id),
    );

    for (const row of rows) {
      if (booked.has(row.requestId)) continue;
      run.considered++;
      try {
        const outcome = await this.consider(row, now);
        if (outcome === 'decided') run.decided++;
        if (outcome === 'staff') run.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Booking agent: ${row.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async consider(row: Candidate, now: Date): Promise<'nothing' | 'decided' | 'staff'> {
    const ref = { caseType: 'REQUEST' as const, caseId: row.requestId };
    const gate = await this.automation.gate(DRAFT, ref);
    if (gate.outcome === 'NONE') return 'nothing';

    const result = draftBooking({
      schedule: row.schedule,
      urgency: row.urgency,
      desiredStartDate: row.desiredStartDate,
      today: colomboToday(now),
      rateType: row.rateType,
      payRate: row.payRate,
      clientRate: row.clientRate,
    });
    if (!result.ok) {
      await this.automation.setHandoverNote(ref, {
        done: `${row.registration} accepted the job offer`,
        waiting: `Staff to make the booking: ${result.why}`,
        next: 'Nothing more from the booking agent on this request',
      });
      return 'staff';
    }

    const proposal: DraftBookingProposal = {
      requestId: row.requestId,
      requestReference: row.reference,
      offerId: row.offerId,
      caregiverId: row.caregiverId,
      caregiverRegistration: row.registration,
      draft: result.draft,
    };
    const decision = await this.automation.decide({
      action: DRAFT,
      case: ref,
      reason: `Draft a booking with ${row.registration}: ${result.summary}`,
      proposal,
      // Once per accepted offer: a draft staff turned down, or deleted, is not made again.
      dedupeKey: `${row.requestId}|${row.offerId}`,
    });
    if (!decision.decisionId) return 'nothing';
    if (decision.outcome === 'EXECUTE') {
      const done = await this.automation.execute(decision.decisionId);
      if (!done.ok) {
        this.logger.warn(`Booking agent: no draft for ${row.reference} - ${done.error}`);
        await this.automation.setHandoverNote(ref, {
          done: `${row.registration} accepted the job offer; a draft booking could not be made (${done.error})`,
          waiting: 'Staff to make the booking',
          next: 'Nothing more from the booking agent on this request',
        });
        return 'staff';
      }
    } else if (decision.outcome === 'PROPOSE') {
      await this.automation.setHandoverNote(ref, {
        done: `${row.registration} accepted the job offer; a booking is drafted and waiting for approval`,
        waiting: 'Staff to approve or decline the draft booking',
        next: 'Create the draft once approved',
      });
    }
    return 'decided';
  }

  /** Creates the draft booking through the same service the staff form uses. It tells nobody and reserves nothing. */
  private readonly createDraft: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as DraftBookingProposal | null;
    if (!p?.requestId || !p.caregiverId || !p.draft) throw new BadRequestException('This proposal has no booking to draft');
    const [existing] = await this.db
      .select({ reference: bookings.reference })
      .from(bookings)
      .where(and(eq(bookings.careRequestId, p.requestId), ne(bookings.status, 'CANCELLED')))
      .limit(1);
    if (existing) throw new BadRequestException(`This request already has a booking (${existing.reference})`);
    const [request] = await this.db.select({ caregiverId: careRequests.caregiverId }).from(careRequests).where(eq(careRequests.id, p.requestId)).limit(1);
    if (request?.caregiverId !== p.caregiverId) throw new BadRequestException('The request has a different caregiver now');

    const { shifts: _shifts, ...pattern } = p.draft;
    void _shifts;
    const booking = await this.bookingsService.create(
      {
        ...pattern,
        careRequestId: p.requestId,
        caregiverId: p.caregiverId,
        notes: 'Drafted from the accepted job offer. The times are the usual ones for this schedule - check them with the client before confirming.',
      },
      { userId: actor.userId, email: actor.email, role: actor.role },
    );
    const clashes = booking.blockingConflicts ?? 0;
    await this.automation.setHandoverNote(
      { caseType: 'REQUEST', caseId: p.requestId },
      {
        done: `Drafted booking ${booking.reference} with ${p.caregiverRegistration}${clashes ? `. The caregiver already has ${clashes} shift${clashes === 1 ? '' : 's'} at these times` : ''}`,
        waiting: 'Staff to check the times with the client and confirm the booking',
        next: 'Nothing more from the booking agent on this request',
      },
    );
    return { bookingId: booking.id, bookingReference: booking.reference, shifts: booking.shifts.length, blockingConflicts: clashes };
  };

  /**
   * Shadow decisions are scored once staff have made the booking: the agent
   * agreed with them when its draft had the same kind of schedule and start date.
   */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.action, DRAFT),
          eq(agentDecisions.outcome, 'SHADOW'),
          isNull(agentDecisions.staffVerdict),
          eq(agentDecisions.caseType, 'REQUEST'),
          only?.length ? inArray(agentDecisions.caseId, only) : undefined,
        ),
      )
      .limit(500);
    if (!open.length) return 0;
    const made = await this.db
      .select()
      .from(bookings)
      .where(and(inArray(bookings.careRequestId, open.map((d) => d.caseId!)), ne(bookings.status, 'CANCELLED')))
      .orderBy(bookings.createdAt);
    let scored = 0;
    for (const d of open) {
      const booking = made.find((b) => b.careRequestId === d.caseId);
      if (!booking) continue;
      const draft = (d.proposal as DraftBookingProposal | null)?.draft;
      const start = typeof booking.startDate === 'string' ? booking.startDate : colomboToday(booking.startDate as unknown as Date);
      const agreed = !!draft && draft.scheduleType === booking.scheduleType && draft.startDate === start;
      await this.automation.review(
        d.id,
        agreed ? 'AGREED' : 'DIFFERED',
        agreed
          ? `Scored automatically: staff made ${booking.reference} with the same schedule and start date`
          : `Scored automatically: staff made ${booking.reference} as ${booking.scheduleType} from ${start}; the agent drafted ${draft?.scheduleType ?? '?'} from ${draft?.startDate ?? '?'}`,
        booking.createdByUserId ?? (await this.automation.agentActor('BOOKING')).userId,
      );
      scored++;
    }
    return scored;
  }
}
