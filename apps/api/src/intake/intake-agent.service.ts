import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { INTAKE_ANSWER_HOURS, requestGaps, type AgentRunResult, type IntakeGap } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { OPEN_CARE_REQUEST_STATUSES, agentDecisions, careRequestEvents, careRequests, patients } from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { nudgeMatching } from '../matching/matching-jobs';
import { INTAKE_REQUEST_JOB, INTAKE_SWEEP_JOB } from './intake-jobs';

const ASK = 'intake.ask_client' as const;
const SWEEP_MS = 15 * 60 * 1000;
const LOOKBACK_DAYS = 30;

/** The client's message: what is missing, in their language. Never anything about health. */
const ASK_TEXT = {
  en: { title: 'A few details for your request', body: 'To find your caregiver we need: {what}. It takes a minute - open your request {reference}.' },
  si: { title: 'ඔබගේ ඉල්ලීමට විස්තර කිහිපයක්', body: 'ඔබට සත්කාරකයෙකු සොයා ගැනීමට අපට අවශ්‍යයි: {what}. එයට මිනිත්තුවක් ගත වේ - ඔබගේ {reference} ඉල්ලීම විවෘත කරන්න.' },
  ta: { title: 'உங்கள் கோரிக்கைக்குச் சில விவரங்கள்', body: 'உங்களுக்கான பராமரிப்பாளரைக் கண்டுபிடிக்க எங்களுக்குத் தேவை: {what}. ஒரு நிமிடம் போதும் - உங்கள் கோரிக்கை {reference} ஐத் திறக்கவும்.' },
} as const;
const GAP_WORDS: Record<'en' | 'si' | 'ta', Record<IntakeGap, string>> = {
  en: { CARE_TYPE: 'the kind of care', AREA: 'where care is needed', SCHEDULE: 'the time of day', START_DATE: 'the start date' },
  si: { CARE_TYPE: 'සත්කාර වර්ගය', AREA: 'සත්කාරය අවශ්‍ය ස්ථානය', SCHEDULE: 'දවසේ වේලාව', START_DATE: 'ආරම්භක දිනය' },
  ta: { CARE_TYPE: 'பராமரிப்பு வகை', AREA: 'பராமரிப்பு தேவைப்படும் இடம்', SCHEDULE: 'நாளின் நேரம்', START_DATE: 'தொடக்க தேதி' },
};
const GAP_STAFF: Record<IntakeGap, string> = { CARE_TYPE: 'the kind of care', AREA: 'the area', SCHEDULE: 'the time of day', START_DATE: 'the start date' };
const listGaps = (gaps: IntakeGap[]) => gaps.map((g) => GAP_STAFF[g]).join(', ');

export interface AskProposal extends Record<string, unknown> {
  requestId: string;
  requestReference: string;
  gaps: IntakeGap[];
}

type Row = {
  id: string;
  reference: string;
  status: string;
  caregiverId: string | null;
  careType: string | null;
  districtId: number | null;
  schedule: string | null;
  desiredStartDate: string | null;
  urgency: string | null;
  detailsAsked: string | null;
  detailsAskedAt: Date | null;
  detailsAnsweredAt: Date | null;
  detailsEscalatedAt: Date | null;
};

/**
 * The intake agent: makes sure an open care request says what a booking
 * needs - the kind of care, where, the time of day and the start date - by
 * asking the client for whatever is missing, then hands the complete request
 * to matching. Exact rules (requestGaps); no AI, nothing medical.
 *
 * - Asking the client is a tier 1 step: done in Auto, proposed in Assist,
 *   only logged in Shadow (then scored by whether staff filled the same gaps).
 * - One question per request. No answer within two days: it goes back to
 *   staff with a note, once.
 * - A client who said they are just exploring is not chased; a request staff
 *   took over is left alone.
 */
@Injectable()
export class IntakeAgentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IntakeAgentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly jobs: JobsService,
    private readonly notices: NotificationsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(ASK, this.ask);
    this.automation.registerRunner('INTAKE', () => this.sweep());
    this.jobs.register(INTAKE_SWEEP_JOB, async () => void (await this.sweep()));
    this.jobs.register(INTAKE_REQUEST_JOB, async (payload) => {
      const id = (payload as { requestId?: unknown }).requestId;
      if (typeof id === 'string') await this.sweep(new Date(), [id]);
    });
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    const queue = () =>
      void this.jobs.enqueue(INTAKE_SWEEP_JOB, {}, { uniqueKey: `${INTAKE_SWEEP_JOB}:${Math.floor(Date.now() / SWEEP_MS)}`, maxAttempts: 2 }).catch((e) => this.logger.warn(`Intake sweep not queued: ${(e as Error).message}`));
    this.timer = setInterval(queue, SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over open requests from the last 30 days - or just the requests in `only`. */
  async sweep(now = new Date(), only?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(ASK);
    const run: AgentRunResult = { function: 'INTAKE', mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
    if (gate.mode === 'MANUAL') return run;
    run.scored = await this.scoreShadows(only);
    if (only && !only.length) return run;

    const rows = await this.db
      .select({
        id: careRequests.id,
        reference: careRequests.reference,
        status: careRequests.status,
        caregiverId: careRequests.caregiverId,
        careType: careRequests.careType,
        // The request's own area, or else where the client lives - the same rule matching uses.
        districtId: sql<number | null>`COALESCE(${careRequests.districtId}, ${patients.districtId})`,
        schedule: sql<string | null>`COALESCE(${careRequests.schedule}, ${patients.careSchedule})`,
        desiredStartDate: careRequests.desiredStartDate,
        urgency: patients.careStart,
        detailsAsked: careRequests.detailsAsked,
        detailsAskedAt: careRequests.detailsAskedAt,
        detailsAnsweredAt: careRequests.detailsAnsweredAt,
        detailsEscalatedAt: careRequests.detailsEscalatedAt,
      })
      .from(careRequests)
      .innerJoin(patients, eq(patients.id, careRequests.patientId))
      .where(
        and(
          inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]),
          only ? inArray(careRequests.id, only) : gte(careRequests.createdAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        ),
      )
      .orderBy(careRequests.createdAt)
      .limit(300);

    for (const r of rows as Row[]) {
      try {
        const outcome = await this.consider(r, now);
        if (outcome !== 'nothing') run.considered++;
        if (outcome === 'decided') run.decided++;
        if (outcome === 'staff') run.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Intake agent: ${r.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async consider(r: Row, now: Date): Promise<'nothing' | 'decided' | 'staff' | 'complete'> {
    const ref = { caseType: 'REQUEST' as const, caseId: r.id };
    const gate = await this.automation.gate(ASK, ref);
    if (gate.outcome === 'NONE') return 'nothing';
    const gaps = requestGaps(r);

    if (!gaps.length) {
      // Complete after the client answered: say so once, and let matching look straight away.
      if (r.detailsAnsweredAt && r.detailsAsked) {
        await this.db.update(careRequests).set({ detailsAsked: null }).where(eq(careRequests.id, r.id));
        await this.automation.setHandoverNote(ref, {
          done: 'The client filled in what the request was missing',
          waiting: r.caregiverId ? 'Nothing from intake' : 'Matching to find a caregiver',
          next: 'Nothing more from the intake agent on this request',
        });
        await nudgeMatching(this.jobs, this.automation, r.id);
        return 'complete';
      }
      return 'nothing';
    }

    // Asked and waiting: after two days with no answer, back to staff - once.
    if (r.detailsAskedAt && !r.detailsAnsweredAt) {
      if (r.detailsEscalatedAt || now.getTime() - r.detailsAskedAt.getTime() < INTAKE_ANSWER_HOURS * 3_600_000) return 'nothing';
      await this.db.update(careRequests).set({ detailsEscalatedAt: now }).where(eq(careRequests.id, r.id));
      await this.automation.setHandoverNote(ref, {
        done: `Asked the client for ${listGaps((r.detailsAsked?.split(',') ?? []) as IntakeGap[])} ${INTAKE_ANSWER_HOURS} hours ago`,
        waiting: `Staff: no answer - phone the client for ${listGaps(gaps)}`,
        next: 'Nothing more from the intake agent until the client answers',
      });
      this.notices.notifyStaff(`No answer on request ${r.reference}`, `The client was asked for ${listGaps(gaps)} two days ago and has not answered - phone them.`, `/requests/${r.id}`, `intake staff ${r.id}`);
      return 'staff';
    }
    // They answered but something is still missing (they could only give part): staff take it from here.
    if (r.detailsAnsweredAt) {
      if (r.detailsEscalatedAt) return 'nothing';
      await this.db.update(careRequests).set({ detailsEscalatedAt: now }).where(eq(careRequests.id, r.id));
      await this.automation.setHandoverNote(ref, { done: 'The client answered', waiting: `Staff: still missing ${listGaps(gaps)}`, next: 'Nothing more from the intake agent' });
      this.notices.notifyStaff(`Request ${r.reference} still incomplete`, `The client answered, but ${listGaps(gaps)} is still missing.`, `/requests/${r.id}`, `intake staff ${r.id}`);
      return 'staff';
    }

    const proposal: AskProposal = { requestId: r.id, requestReference: r.reference, gaps };
    const decision = await this.automation.decide({
      action: ASK,
      case: ref,
      reason: `Ask the client for ${listGaps(gaps)}: matching and the booking need ${gaps.length === 1 ? 'it' : 'them'}`,
      proposal,
      dedupeKey: `${r.id}|${gaps.join(',')}`,
    });
    if (!decision.decisionId) return 'nothing';
    if (decision.outcome === 'EXECUTE') {
      const result = await this.automation.execute(decision.decisionId);
      if (!result.ok) {
        this.logger.warn(`Intake agent: asking about ${r.reference} failed - ${result.error}`);
        return 'nothing';
      }
    } else if (decision.outcome === 'PROPOSE') {
      await this.automation.setHandoverNote(ref, { done: `Found the request is missing ${listGaps(gaps)}`, waiting: 'Staff to approve asking the client', next: 'Ask the client once approved' });
    }
    return 'decided';
  }

  /** Asks the client: bell and push, and WhatsApp when updates can go that way. Records what was asked, so their request shows the form. */
  private readonly ask: ActionExecutor = async (decision) => {
    const p = decision.proposal as AskProposal | null;
    if (!p?.requestId) throw new BadRequestException('This proposal has no request');
    const [r] = await this.db
      .select({
        status: careRequests.status,
        asked: careRequests.detailsAskedAt,
        language: careRequests.language,
        userId: patients.userId,
        phone: patients.phone,
        preferred: patients.preferredContactMethod,
      })
      .from(careRequests)
      .innerJoin(patients, eq(patients.id, careRequests.patientId))
      .where(eq(careRequests.id, p.requestId))
      .limit(1);
    if (!r || !OPEN_CARE_REQUEST_STATUSES.includes(r.status as (typeof OPEN_CARE_REQUEST_STATUSES)[number])) throw new BadRequestException('This request is no longer open');
    if (r.asked) throw new BadRequestException('The client has already been asked');
    const now = new Date();
    await this.db.update(careRequests).set({ detailsAsked: p.gaps.join(','), detailsAskedAt: now, detailsAnsweredAt: null, detailsEscalatedAt: null }).where(eq(careRequests.id, p.requestId));
    await this.db.insert(careRequestEvents).values({ id: uuid(), requestId: p.requestId, type: 'NOTE', note: `Asked the client for ${listGaps(p.gaps)}`, actorUserId: (await this.automation.agentActor('INTAKE')).userId });

    const words = (lang: 'en' | 'si' | 'ta') => ({ title: ASK_TEXT[lang].title, body: ASK_TEXT[lang].body.replace('{what}', p.gaps.map((g) => GAP_WORDS[lang][g]).join(', ')).replace('{reference}', p.requestReference) });
    this.notices.notify([r.userId], words, `/requests/${p.requestId}`, `intake ask ${p.requestId}`);
    const told = ['bell'];
    try {
      const wa = await this.whatsappSettings.getResolved();
      const phone = normalizePhone(r.phone, await this.whatsappSettings.getDefaultCountryCode());
      if (phone && r.preferred !== 'PHONE_CALL' && this.whatsapp.canSendUpdates(wa)) {
        const lang = (r.language ?? 'en') as 'en' | 'si' | 'ta';
        const w = words(lang);
        await this.whatsapp.sendUpdate(wa, phone, lang, `{brand}: ${w.title}. ${w.body}`);
        told.push('whatsapp');
      }
    } catch (err) {
      this.logger.warn(`Intake agent: WhatsApp for ${p.requestReference} failed - ${(err as Error).message}`);
    }
    await this.automation.setHandoverNote(
      { caseType: 'REQUEST', caseId: p.requestId },
      { done: `Asked the client for ${listGaps(p.gaps)}`, waiting: `The client to answer (up to ${INTAKE_ANSWER_HOURS} hours)`, next: 'Hand the complete request to matching; staff if there is no answer' },
    );
    return { told };
  };

  /**
   * "Ask the client" logged in Shadow is scored once the request has moved
   * on: the gaps it named were filled (by staff, by phone) = agreed; the
   * request got a caregiver or closed with them still empty = differed
   * (staff did not need them).
   */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.action, ASK), eq(agentDecisions.outcome, 'SHADOW'), isNull(agentDecisions.staffVerdict), eq(agentDecisions.caseType, 'REQUEST')))
      .limit(500);
    const mine = open.filter((d) => !only?.length || only.includes(d.caseId!));
    if (!mine.length) return 0;
    const rows = await this.db
      .select({
        id: careRequests.id,
        status: careRequests.status,
        caregiverId: careRequests.caregiverId,
        careType: careRequests.careType,
        districtId: sql<number | null>`COALESCE(${careRequests.districtId}, ${patients.districtId})`,
        schedule: sql<string | null>`COALESCE(${careRequests.schedule}, ${patients.careSchedule})`,
        desiredStartDate: careRequests.desiredStartDate,
        urgency: patients.careStart,
        by: careRequests.assignedToUserId,
      })
      .from(careRequests)
      .innerJoin(patients, eq(patients.id, careRequests.patientId))
      .where(inArray(careRequests.id, mine.map((d) => d.caseId!)));
    let scored = 0;
    const agent = (await this.automation.agentActor('INTAKE')).userId;
    for (const d of mine) {
      const r = rows.find((x) => x.id === d.caseId);
      if (!r) continue;
      const named = ((d.proposal as AskProposal | null)?.gaps ?? []) as IntakeGap[];
      const left = requestGaps(r).filter((g) => named.includes(g));
      const movedOn = Boolean(r.caregiverId) || !OPEN_CARE_REQUEST_STATUSES.includes(r.status);
      if (left.length && !movedOn) continue; // still playing out
      const agreed = left.length === 0;
      await this.automation.review(
        d.id,
        agreed ? 'AGREED' : 'DIFFERED',
        agreed ? 'Scored automatically: staff filled in what it would have asked for' : 'Scored automatically: the request went ahead without it',
        r.by ?? agent,
      );
      scored++;
    }
    return scored;
  }
}

