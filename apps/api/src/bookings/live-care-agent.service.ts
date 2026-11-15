import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { toColombo, type AgentRunResult } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { agentDecisions, bookingShifts, bookings, caregivers, shiftCheckins, users } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { BookingsService } from './bookings.service';
import { CheckInService } from './check-in.service';
import type { UpdateShiftDto } from './dto/booking.dto';
import { LIVE_CARE_SHIFT_JOB, LIVE_CARE_SWEEP_JOB } from './live-care-jobs';
import { FLAG_AFTER_CHASE_MINUTES, FLAG_NEXT, LIVE_WINDOW_HOURS, flagReason, liveStep, type FlagKind } from './live-care-rules';

const CHASE = 'live_care.chase_late_caregiver' as const;
const FLAG = 'live_care.flag_visit' as const;
const COMPLETE = 'live_care.complete_shift' as const;
const ACTIONS = [CHASE, FLAG, COMPLETE];
/** Lateness is counted in minutes, so this agent looks more often than the others. */
const SWEEP_MS = 2 * 60 * 1000;

/** What every live-care decision carries: ids, references and times - nobody's name or contact. */
export interface VisitProposal extends Record<string, unknown> {
  bookingId: string;
  bookingReference: string;
  shiftId: string;
  caregiverId: string;
  caregiverRegistration: string;
  /** The shift's start, ISO. */
  startsAt: string;
  kind?: FlagKind;
  minutes?: number;
  ofMinutes?: number;
}

/** "Please check in" - the caregiver's bell and push, and the WhatsApp message, in their language. */
const CHASE_TEXT = {
  en: { title: 'Please check in for your shift', body: 'Your shift started at {time} and you have not checked in. If you are with the client, check in now with their code. If you cannot be there, call the office.' },
  si: { title: 'ඔබගේ වාරය සඳහා පැමිණීම සටහන් කරන්න', body: 'ඔබගේ වාරය {time} ට ආරම්භ වූ නමුත් ඔබ පැමිණීම සටහන් කර නැත. ඔබ සේවාලාභියා සමඟ සිටී නම්, ඔවුන්ගේ කේතයෙන් දැන් පැමිණීම සටහන් කරන්න. ඔබට එහි සිටිය නොහැකි නම්, කාර්යාලයට අමතන්න.' },
  ta: { title: 'உங்கள் பணிநேரத்திற்கு வருகையைப் பதிவுசெய்யுங்கள்', body: 'உங்கள் பணிநேரம் {time} மணிக்குத் தொடங்கியது, ஆனால் நீங்கள் வருகையைப் பதிவுசெய்யவில்லை. நீங்கள் வாடிக்கையாளருடன் இருந்தால், அவர்களின் குறியீட்டைக் கொண்டு இப்போதே பதிவுசெய்யுங்கள். வர முடியாவிட்டால், அலுவலகத்தை அழைக்கவும்.' },
} as const;

type Row = {
  shiftId: string;
  bookingId: string;
  reference: string;
  startsAt: Date | string;
  endsAt: Date | string;
  status: string;
  caregiverId: string;
  registration: string;
  checkedInAt: Date | string | null;
  checkedOutAt: Date | string | null;
};

/**
 * The live-care agent: it watches the visits that are under way, the way a
 * staff member watches Today's visits.
 *
 *  - A visit that started a while ago with nobody checked in: it asks the
 *    caregiver to check in or call the office (bell, push and WhatsApp). Once.
 *  - Still nobody a quarter of an hour later, or the visit ended with no
 *    check-in, or the caregiver left well before the end: it emails staff,
 *    with what to do next. It never tells the client - most "late" visits are
 *    a caregiver who forgot to check in, and a person should make that call.
 *  - The caregiver checked in and out and was there for most of the shift:
 *    it marks the shift done, which is what lets it be billed and paid.
 *
 * It needs shift check-in to be switched on; without it there is nothing to
 * watch and it does nothing. It never marks a shift missed, never replaces a
 * caregiver and never changes a shift's times - those stay with staff.
 *
 * Shadow logs each step silently, and scores "mark done" against what staff
 * did with the shift. Assist proposes the chase and "mark done" (telling
 * staff needs no approval). Auto does them. No model is involved.
 */
@Injectable()
export class LiveCareAgentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LiveCareAgentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly jobs: JobsService,
    private readonly bookingsService: BookingsService,
    private readonly checkIns: CheckInService,
    private readonly notices: NotificationsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(CHASE, this.chase);
    this.automation.registerExecutor(FLAG, this.flag);
    this.automation.registerExecutor(COMPLETE, this.complete);
    this.automation.registerRunner('LIVE_CARE', () => this.sweep());
    this.jobs.register(LIVE_CARE_SWEEP_JOB, async () => void (await this.sweep()));
    this.jobs.register(LIVE_CARE_SHIFT_JOB, async (payload) => {
      const shiftId = (payload as { shiftId?: unknown }).shiftId;
      if (typeof shiftId === 'string') await this.sweep(new Date(), [shiftId]);
    });
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    const schedule = () =>
      void this.jobs
        .enqueue(LIVE_CARE_SWEEP_JOB, {}, { uniqueKey: `${LIVE_CARE_SWEEP_JOB}:${Math.floor(Date.now() / SWEEP_MS)}`, maxAttempts: 1 })
        .catch((e) => this.logger.warn(`Could not queue the live-care sweep: ${(e as Error).message}`));
    this.timer = setInterval(schedule, SWEEP_MS / 2);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the scheduled visits that have started and not long ended - all, or just the shifts in `only`. */
  async sweep(now = new Date(), only?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(CHASE);
    const run: AgentRunResult = { function: 'LIVE_CARE', mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if (gate.mode === 'MANUAL') return run;
    const settings = await this.checkIns.settings();
    // With check-in off nobody can check in, so "nobody checked in" means nothing.
    if (!settings.enabled) return run;
    run.scored = await this.scoreShadows(only);
    if (only && !only.length) return run;

    const rows: Row[] = await this.db
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
        checkedOutAt: shiftCheckins.checkedOutAt,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .innerJoin(caregivers, eq(bookingShifts.caregiverId, caregivers.id))
      .leftJoin(shiftCheckins, eq(shiftCheckins.shiftId, bookingShifts.id))
      .where(
        and(
          eq(bookings.status, 'CONFIRMED'),
          eq(bookingShifts.status, 'SCHEDULED'),
          only ? inArray(bookingShifts.id, only) : and(lt(bookingShifts.startsAt, now), gt(bookingShifts.endsAt, new Date(now.getTime() - LIVE_WINDOW_HOURS * 3_600_000))),
        ),
      )
      .orderBy(bookingShifts.startsAt)
      .limit(500);
    if (!rows.length) return run;

    // What the agent has already done or proposed on these visits.
    const earlier = await this.db
      .select({ action: agentDecisions.action, proposal: agentDecisions.proposal, createdAt: agentDecisions.createdAt, executedAt: agentDecisions.executedAt })
      .from(agentDecisions)
      .where(
        and(
          inArray(agentDecisions.action, ACTIONS),
          eq(agentDecisions.caseType, 'BOOKING'),
          inArray(agentDecisions.caseId, [...new Set(rows.map((r) => r.bookingId))]),
          gte(agentDecisions.createdAt, new Date(now.getTime() - 3 * 86_400_000)),
        ),
      );
    const done = new Map<string, { chasedAt: Date | null; flags: Set<string>; complete: boolean }>();
    for (const d of earlier) {
      const p = d.proposal as VisitProposal | null;
      if (!p?.shiftId) continue;
      const seen = done.get(p.shiftId) ?? { chasedAt: null, flags: new Set<string>(), complete: false };
      if (d.action === CHASE) seen.chasedAt = new Date(d.executedAt ?? d.createdAt);
      if (d.action === FLAG && p.kind) seen.flags.add(p.kind);
      if (d.action === COMPLETE) seen.complete = true;
      done.set(p.shiftId, seen);
    }

    for (const row of rows) {
      const seen = done.get(row.shiftId);
      const step = liveStep({ ...row, chasedAt: seen?.chasedAt ?? null }, settings, now);
      if (step.step === 'none') continue;
      if (step.step === 'flag' && seen?.flags.has(step.kind)) continue;
      if (step.step === 'complete' && seen?.complete) continue;
      run.considered++;
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
        const decision =
          step.step === 'chase'
            ? await this.automation.decide({
                action: CHASE,
                case: ref,
                reason: `Ask ${row.registration} to check in: the ${time} visit started ${step.minutesLate} min ago with nobody checked in`,
                proposal: { ...base, minutes: step.minutesLate },
                dedupeKey: row.shiftId,
              })
            : step.step === 'flag'
              ? await this.automation.decide({
                  action: FLAG,
                  case: ref,
                  reason: flagReason(step.kind, step, row.registration, time),
                  proposal: { ...base, kind: step.kind, minutes: step.minutes, ofMinutes: step.ofMinutes },
                  dedupeKey: `${row.shiftId}|${step.kind}`,
                })
              : await this.automation.decide({
                  action: COMPLETE,
                  case: ref,
                  reason: `Mark the ${time} shift done: ${row.registration} checked in and out, and was there ${step.minutesThere} of ${step.ofMinutes} minutes`,
                  proposal: { ...base, minutes: step.minutesThere, ofMinutes: step.ofMinutes },
                  dedupeKey: row.shiftId,
                });
        if (!decision.decisionId) continue;
        if (decision.outcome === 'EXECUTE') {
          const result = await this.automation.execute(decision.decisionId);
          if (!result.ok) {
            this.logger.warn(`Live-care agent: ${step.step} on ${row.reference} failed - ${result.error}`);
            continue;
          }
        }
        run.decided++;
        if (step.step === 'flag' && decision.outcome === 'EXECUTE') run.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Live-care agent: ${row.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async visit(p: VisitProposal | null) {
    if (!p?.shiftId || !p.bookingId) throw new BadRequestException('This proposal has no visit');
    const [row] = await this.db
      .select({
        status: bookingShifts.status,
        caregiverId: bookingShifts.caregiverId,
        checkedInAt: shiftCheckins.checkedInAt,
        checkedOutAt: shiftCheckins.checkedOutAt,
        caregiverUserId: caregivers.userId,
        accountPhone: users.phone,
        primaryPhone: caregivers.primaryPhone,
        preferred: caregivers.preferredContactMethod,
      })
      .from(bookingShifts)
      .innerJoin(caregivers, eq(bookingShifts.caregiverId, caregivers.id))
      .leftJoin(users, eq(users.id, caregivers.userId))
      .leftJoin(shiftCheckins, eq(shiftCheckins.shiftId, bookingShifts.id))
      .where(and(eq(bookingShifts.id, p.shiftId), eq(bookingShifts.bookingId, p.bookingId)))
      .limit(1);
    if (!row || row.status !== 'SCHEDULED') throw new BadRequestException('This shift is no longer scheduled');
    return row;
  }

  /** Asks the caregiver to check in or call: bell and push, and WhatsApp when updates can go that way. Says nothing about the client. */
  private readonly chase: ActionExecutor = async (decision) => {
    const p = decision.proposal as VisitProposal | null;
    const v = await this.visit(p);
    if (v.checkedInAt) throw new BadRequestException('The caregiver has checked in since');
    if (v.caregiverId !== p!.caregiverId) throw new BadRequestException('This shift has a different caregiver now');
    const time = toColombo(p!.startsAt).time;
    const told = ['bell'];
    this.notices.notify([v.caregiverUserId], (lang) => ({ title: CHASE_TEXT[lang].title, body: CHASE_TEXT[lang].body.replace('{time}', time) }), '/shifts', `check-in chase ${p!.shiftId}`);
    try {
      const wa = await this.whatsappSettings.getResolved();
      const phone = v.accountPhone ?? normalizePhone(v.primaryPhone, await this.whatsappSettings.getDefaultCountryCode());
      // A caregiver who asked to be phoned is not messaged; staff will phone if they stay late.
      if (phone && v.preferred !== 'PHONE_CALL' && this.whatsapp.canSendUpdates(wa)) {
        const text = (['en', 'si', 'ta'] as const).map((l) => `${CHASE_TEXT[l].title}. ${CHASE_TEXT[l].body.replace('{time}', time)}`).join(' / ');
        await this.whatsapp.sendUpdate(wa, phone, 'en', `{brand}: ${text}`);
        told.push('whatsapp');
      }
    } catch (err) {
      this.logger.warn(`Live-care agent: WhatsApp chase for ${p!.bookingReference} failed - ${(err as Error).message}`);
    }
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p!.bookingId },
      {
        done: `Asked ${p!.caregiverRegistration} to check in for the ${time} visit (${told.join(' and ')})`,
        waiting: 'The caregiver to check in',
        next: `Tell staff if nobody has checked in ${FLAG_AFTER_CHASE_MINUTES} minutes from now`,
      },
    );
    return { told };
  };

  /**
   * The people who get operational alerts: the configured alert list (the one
   * new care requests go to), or else every active admin and staff account
   * with an email address.
   */
  private async staffRecipients(): Promise<string[]> {
    const settings = await this.emailSettings.getResolved();
    if (settings.requestAlertsTo) {
      return settings.requestAlertsTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    }
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true), isNotNull(users.email)));
    return rows.map((r) => r.email!).filter(Boolean);
  }

  /**
   * Tells staff by email (the staff app has no notification bell) and leaves
   * the reason and the next step on the booking. The visit is also on Today's
   * visits and in the dashboard's count whether or not the email arrives.
   */
  private readonly flag: ActionExecutor = async (decision) => {
    const p = decision.proposal as VisitProposal | null;
    if (!p?.shiftId || !p.kind) throw new BadRequestException('This proposal has no visit');
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p.bookingId },
      { done: decision.reason, waiting: FLAG_NEXT[p.kind], next: 'Nothing more from the live-care agent on this visit' },
    );
    const to = await this.staffRecipients();
    if (!to.length) {
      this.logger.warn(`Live-care agent: ${p.bookingReference} needs a person and there is no staff email address to alert - it is on Today's visits.`);
      return { staffEmailed: 0 };
    }
    const subject = p.kind === 'LEFT_EARLY' ? `Visit cut short: ${p.bookingReference}` : `Visit not checked in: ${p.bookingReference}`;
    try {
      await this.email.sendNotificationEmail(
        to,
        {
          subject,
          blocks: [{ lang: 'en', heading: subject, paragraphs: [`${decision.reason}.`, `${FLAG_NEXT[p.kind]}.`, 'Sent by the live-care agent. Take over the booking to stop it acting on this booking.'] }],
          cta: { label: "Open Today's visits", url: `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}/bookings/today` },
        },
        `visit ${p.shiftId} ${p.kind}`,
      );
    } catch (err) {
      this.logger.warn(`Live-care agent: staff email for ${p.bookingReference} failed - ${(err as Error).message}`);
      return { staffEmailed: 0 };
    }
    return { staffEmailed: to.length };
  };

  /** Marks the shift done, through the same service as the staff page: no times change and no money moves. */
  private readonly complete: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as VisitProposal | null;
    const v = await this.visit(p);
    if (!v.checkedInAt || !v.checkedOutAt) throw new BadRequestException('This visit has no check-in and check-out');
    await this.bookingsService.updateShift(p!.bookingId, p!.shiftId, { status: 'COMPLETED' } as UpdateShiftDto, { userId: actor.userId, email: actor.email, role: actor.role });
    await this.automation.setHandoverNote(
      { caseType: 'BOOKING', caseId: p!.bookingId },
      { done: `Marked the ${toColombo(p!.startsAt).time} shift done after ${p!.caregiverRegistration} checked out`, waiting: 'Nothing', next: 'Nothing more from the live-care agent on this visit' },
    );
    return { shiftId: p!.shiftId };
  };

  /**
   * "Mark done" logged in Shadow is scored by what staff did with the shift:
   * done = agreed; missed or cancelled = differed. Chases and flags have no
   * staff action to compare with and stay unscored.
   */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, COMPLETE), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict), eq(agentDecisions.caseType, 'BOOKING')))
      .limit(500);
    const mine = open.filter((d) => {
      const id = (d.proposal as VisitProposal | null)?.shiftId;
      return !!id && (!only?.length || only.includes(id));
    });
    if (!mine.length) return 0;
    const shifts = await this.db
      .select({ id: bookingShifts.id, status: bookingShifts.status, by: bookingShifts.updatedByUserId })
      .from(bookingShifts)
      .where(and(inArray(bookingShifts.id, mine.map((d) => (d.proposal as VisitProposal).shiftId)), inArray(bookingShifts.status, ['COMPLETED', 'MISSED', 'CANCELLED'])));
    let scored = 0;
    for (const d of mine) {
      const p = d.proposal as VisitProposal;
      const shift = shifts.find((s) => s.id === p.shiftId);
      if (!shift) continue;
      const agreed = shift.status === 'COMPLETED';
      await this.automation.review(
        d.id,
        agreed ? 'AGREED' : 'DIFFERED',
        agreed ? 'Scored automatically: staff marked the shift done' : `Scored automatically: staff marked the shift ${shift.status.toLowerCase()}`,
        shift.by ?? (await this.automation.agentActor('LIVE_CARE')).userId,
      );
      scored++;
    }
    return scored;
  }
}
