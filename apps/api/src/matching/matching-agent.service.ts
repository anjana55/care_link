import { BadRequestException, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, exists, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import {
  CARE_OFFER_MINUTES,
  MAX_OPEN_CARE_OFFERS,
  PUBLIC_CAREGIVER_STATUSES,
  addDays,
  colomboToday,
  effectiveCareOfferStatus,
  rateProblem,
  type AgentRunResult,
  type CareType,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  CARE_TYPE_COLUMNS,
  OPEN_CARE_REQUEST_STATUSES,
  agentDecisions,
  availability,
  bookings,
  careRequests,
  careTypePricing,
  caregiverRates,
  caregivers,
  cities,
  districts,
  patients,
  preferredLocations,
  requestOffers,
} from '../database/schema';
import { AutomationService, type ActionExecutor } from '../automation/automation.service';
import { AgentModelService } from '../automation/agent-model.service';
import { AiUnavailableError } from '../ai/ai-provider.service';
import { JobsService } from '../jobs/jobs.service';
import { ReviewStore } from '../reviews/review-store.service';
import { ReviewSettingsService } from '../reviews/review-settings.service';
import { ratingSignal } from '../reviews/review-rules';
import { OffersService } from '../offers/offers.service';
import {
  MODEL_SHORTLIST,
  RANK_PROMPT_VERSION,
  applyModelOrder,
  buildRankPrompt,
  offerMinutesFor,
  rankMatches,
  type MatchCandidate,
  type MatchRequest,
  type RankedMatch,
} from './matching-rules';

import { MATCHING_REQUEST_JOB, MATCHING_SWEEP_JOB } from './matching-jobs';

const RANK = 'matching.rank_caregivers' as const;
const SEND = 'matching.send_offer' as const;
const SWEEP_MS = 5 * 60 * 1000;

/** Offers the agent keeps waiting on one request at a time. The first to accept gets the job. */
export const MATCH_WAVE = 3;
/** After this many offers on one request with nobody accepting, a person takes it from here. */
export const MATCH_MAX_OFFERS = 9;
/** Requests older than this are not picked up: by then a person is dealing with them. */
const LOOKBACK_DAYS = 30;
/** The most caregivers scored for one request. */
const POOL_LIMIT = 300;
const VERIFIED = new Set(['VERIFIED', 'ACTIVE']);
/** A DATE column as YYYY-MM-DD, read with the same clock the driver built it with. */
const dayOf = (d: Date | string | null): string | null =>
  !d ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10);

/** What the agent logs when it ranks: ids, registration numbers and reasons - nobody's name. */
export interface RankProposal extends Record<string, unknown> {
  requestId: string;
  requestReference: string;
  eligible: number;
  rankedBy: 'rules' | 'rules+model';
  ranked: RankedMatch[];
}

export interface SendOfferProposal extends Record<string, unknown> {
  requestId: string;
  requestReference: string;
  caregiverId: string;
  caregiverRegistration: string;
  rank: number;
  score: number;
  reasons: string[];
  expiresInMinutes: number;
}

type RequestRow = {
  id: string;
  reference: string;
  status: (typeof careRequests.$inferSelect)['status'];
  caregiverId: string | null;
  careType: CareType | null;
  districtId: number | null;
  cityId: number | null;
  desiredStartDate: string | null;
  assignedToUserId: string | null;
  schedule: MatchRequest['schedule'];
  urgency: MatchRequest['urgency'];
  genderPreference: 'NO_PREFERENCE' | 'MALE' | 'FEMALE' | null;
};

/**
 * The matching agent: for a request nobody has been chosen for, work out who
 * fits, and offer them the job.
 *
 * Who fits is decided in two steps. Hard checks first, in code: the caregiver
 * is listed, has an account to answer on, does this kind of care, lives in or
 * travels to the district, matches a stated gender preference, and has not
 * already been offered this request. Then the rules in matching-rules.ts
 * order those who pass, with a reason for every point.
 *
 * A model is optional. When one is set up for Matching and cleared for
 * personal data, it is shown the top of the list as "C1, C2..." with the same
 * facts the rules used - never a name, number, address or health detail - and
 * may move people a few places. Its answer is checked in code; if it fails,
 * or there is no model, the rules' order stands. The agent works without one.
 *
 * What happens next depends on the dial:
 *  - Shadow: logs who it would have offered the job to, then scores itself
 *    once staff have chosen someone.
 *  - Assist: proposes each offer; a staff member approves and it is sent
 *    under their name.
 *  - Auto: sends the offers. It keeps up to three waiting; when one is turned
 *    down or runs out, the next caregiver on the list is offered the job.
 *
 * The first caregiver to accept gets the job (see OffersService). Making the
 * booking stays with staff. After nine offers with nobody accepting, or when
 * nobody fits, the request goes back to staff with the reason.
 */
@Injectable()
export class MatchingAgentService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MatchingAgentService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly models: AgentModelService,
    private readonly jobs: JobsService,
    private readonly offers: OffersService,
    private readonly reviewStore: ReviewStore,
    private readonly reviewSettings: ReviewSettingsService,
  ) {}

  onApplicationBootstrap() {
    this.automation.registerExecutor(RANK, async (decision) => ({ ranked: ((decision.proposal as RankProposal | null)?.ranked ?? []).length }));
    this.automation.registerExecutor(SEND, this.sendOffer);
    this.automation.registerRunner('MATCHING', () => this.sweep());
    this.jobs.register(MATCHING_SWEEP_JOB, async () => void (await this.sweep()));
    this.jobs.register(MATCHING_REQUEST_JOB, async (payload) => {
      const requestId = (payload as { requestId?: unknown }).requestId;
      if (typeof requestId === 'string') await this.sweep(new Date(), [requestId]);
    });
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    // One sweep every five minutes across all API instances: the time slot is the idempotency key.
    const schedule = () =>
      void this.jobs
        .enqueue(MATCHING_SWEEP_JOB, {}, { uniqueKey: `${MATCHING_SWEEP_JOB}:${Math.floor(Date.now() / SWEEP_MS)}`, maxAttempts: 2 })
        .catch((e) => this.logger.warn(`Could not queue the matching sweep: ${(e as Error).message}`));
    this.timer = setInterval(schedule, SWEEP_MS / 2);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the open requests with no caregiver - all of them, or just `only`. Does nothing while Matching is Manual. */
  async sweep(now = new Date(), only?: string[]): Promise<AgentRunResult> {
    const gate = await this.automation.gate(SEND);
    const run: AgentRunResult = { function: 'MATCHING', mode: gate.mode, considered: 0, decided: 0, scored: 0, leftToStaff: 0 };
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
        districtId: sql<number | null>`COALESCE(${careRequests.districtId}, ${patients.districtId})`,
        cityId: sql<number | null>`IF(${careRequests.districtId} IS NULL, ${patients.cityId}, ${careRequests.cityId})`,
        desiredStartDate: careRequests.desiredStartDate,
        assignedToUserId: careRequests.assignedToUserId,
        schedule: patients.careSchedule,
        urgency: patients.careStart,
        genderPreference: patients.preferredCaregiverGender,
      })
      .from(careRequests)
      .innerJoin(patients, eq(patients.id, careRequests.patientId))
      .where(
        only
          ? inArray(careRequests.id, only)
          : and(
              inArray(careRequests.status, [...OPEN_CARE_REQUEST_STATUSES]),
              isNull(careRequests.caregiverId),
              gte(careRequests.createdAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
            ),
      )
      .orderBy(careRequests.createdAt)
      .limit(200);

    for (const request of rows as RequestRow[]) {
      run.considered++;
      try {
        const outcome = await this.consider(request, now);
        if (outcome === 'decided') run.decided++;
        if (outcome === 'staff') run.leftToStaff++;
      } catch (err) {
        this.logger.warn(`Matching agent: ${request.reference} skipped - ${(err as Error).message}`);
      }
    }
    return run;
  }

  private async consider(request: RequestRow, now: Date): Promise<'nothing' | 'decided' | 'staff'> {
    const ref = { caseType: 'REQUEST' as const, caseId: request.id };
    const gate = await this.automation.gate(SEND, ref);
    if (gate.outcome === 'NONE') return 'nothing';

    const [offerRows, decisionRows] = await Promise.all([
      this.db.select().from(requestOffers).where(eq(requestOffers.requestId, request.id)),
      this.db
        .select({ outcome: agentDecisions.outcome, staffVerdict: agentDecisions.staffVerdict, proposal: agentDecisions.proposal })
        .from(agentDecisions)
        .where(and(eq(agentDecisions.action, SEND), eq(agentDecisions.caseType, 'REQUEST'), eq(agentDecisions.caseId, request.id))),
    ]);
    const agentUser = (await this.automation.agentActor('MATCHING')).userId;
    const agentOffered = offerRows.some((o) => o.sentByUserId === agentUser) || decisionRows.some((d) => d.outcome === 'PROPOSED' && d.staffVerdict === 'AGREED');

    // Someone has the job (an offer was accepted, or staff chose a caregiver): the agent's part is over.
    if (request.caregiverId || !OPEN_CARE_REQUEST_STATUSES.includes(request.status)) {
      if (request.caregiverId && agentOffered && offerRows.some((o) => o.status === 'ACCEPTED')) {
        await this.automation.setHandoverNote(ref, {
          done: 'A caregiver accepted the job offer and is attached to the request',
          waiting: 'Staff to make the booking; the agreed rates are filled in',
          next: 'Nothing more from the matching agent on this request',
        });
      }
      return 'nothing';
    }
    if (request.urgency === 'JUST_EXPLORING') return 'nothing';

    if (!request.careType || !request.districtId) {
      await this.automation.setHandoverNote(ref, {
        done: 'Looked at the request',
        waiting: `Staff: the request does not say ${!request.careType ? 'what kind of care is needed' : 'where the care is needed'}`,
        next: 'Will look for caregivers once that is filled in',
      });
      return 'staff';
    }

    const waiting = offerRows.filter((o) => effectiveCareOfferStatus(o.status, o.expiresAt, now) === 'OFFERED').length;
    const pending = decisionRows.filter((d) => d.outcome === 'PROPOSED' && d.staffVerdict === null).length;
    const shadowed = decisionRows.filter((d) => d.outcome === 'SHADOW').length;
    const used = offerRows.length + pending;
    const room = gate.outcome === 'SHADOW' ? MATCH_WAVE - shadowed : Math.min(MATCH_WAVE - waiting - pending, MATCH_MAX_OFFERS - used, MAX_OPEN_CARE_OFFERS - waiting);
    if (room <= 0) {
      if (gate.outcome !== 'SHADOW' && waiting + pending === 0 && used >= MATCH_MAX_OFFERS) {
        await this.automation.setHandoverNote(ref, {
          done: `Offered the job to ${offerRows.length} caregivers; nobody accepted`,
          waiting: 'Staff to find a caregiver another way, or widen what the client will accept',
          next: 'Nothing more from the matching agent on this request',
        });
        return 'staff';
      }
      return 'nothing';
    }

    const exclude = new Set<string>([...offerRows.map((o) => o.caregiverId), ...decisionRows.map((d) => (d.proposal as SendOfferProposal | null)?.caregiverId).filter((v): v is string => !!v)]);
    const today = colomboToday(now);
    const match: MatchRequest = {
      careType: request.careType,
      districtId: request.districtId,
      cityId: request.cityId,
      schedule: request.schedule,
      urgency: request.urgency,
      desiredStartDate: request.desiredStartDate ?? (request.urgency === 'IMMEDIATELY' || request.urgency === 'WITHIN_WEEK' ? today : null),
    };
    const pool = await this.candidates(request, match, exclude, now);
    if (!pool.length) {
      await this.automation.setHandoverNote(ref, {
        done: exclude.size ? `Offered the job to everyone who fits (${exclude.size}); nobody accepted` : 'Looked for caregivers who do this kind of care in the district and found none',
        waiting: 'Staff to find a caregiver another way',
        next: 'Will look again when the next caregiver who fits is listed',
      });
      return 'staff';
    }

    const { ranked, model } = await this.rank(match, pool);
    const top = ranked.slice(0, MODEL_SHORTLIST);
    const rankProposal: RankProposal = { requestId: request.id, requestReference: request.reference, eligible: pool.length, rankedBy: model ? 'rules+model' : 'rules', ranked: top };
    const ranking = await this.automation.decide({
      action: RANK,
      case: ref,
      reason: `${pool.length} caregiver${pool.length === 1 ? ' fits' : 's fit'}. Best first: ${top.slice(0, MATCH_WAVE).map((r) => `${r.registrationNumber} (${r.score})`).join(', ')}`,
      proposal: rankProposal,
      model,
      promptVersion: model ? RANK_PROMPT_VERSION : null,
      // A new ranking is logged each time the people it can choose from change.
      dedupeKey: `${request.id}|${exclude.size}|${top.map((r) => r.caregiverId.slice(0, 8)).join('')}`.slice(0, 190),
    });
    if (ranking.decisionId && ranking.outcome === 'EXECUTE') await this.automation.execute(ranking.decisionId);

    const minutes = Math.max(CARE_OFFER_MINUTES.min, offerMinutesFor(request.urgency));
    const sent: string[] = [];
    let proposed = 0;
    let logged = 0;
    for (const [i, r] of ranked.slice(0, room).entries()) {
      const proposal: SendOfferProposal = {
        requestId: request.id,
        requestReference: request.reference,
        caregiverId: r.caregiverId,
        caregiverRegistration: r.registrationNumber,
        rank: i + 1,
        score: r.score,
        reasons: r.reasons,
        expiresInMinutes: minutes,
      };
      const decision = await this.automation.decide({
        action: SEND,
        case: ref,
        reason: `Offer the job to ${r.registrationNumber}: ${r.reasons.slice(0, 4).join('; ') || 'fits the request'}`,
        confidence: Math.max(0, Math.min(1, r.score / 100)),
        proposal,
        model,
        promptVersion: model ? RANK_PROMPT_VERSION : null,
        dedupeKey: `${request.id}|${r.caregiverId}`,
      });
      if (!decision.decisionId) continue;
      if (decision.outcome === 'EXECUTE') {
        const done = await this.automation.execute(decision.decisionId);
        if (done.ok) sent.push(r.registrationNumber);
        else this.logger.warn(`Matching agent: offer to ${r.registrationNumber} on ${request.reference} not sent - ${done.error}`);
      } else if (decision.outcome === 'PROPOSE') proposed++;
      else logged++;
    }

    if (sent.length) {
      await this.automation.setHandoverNote(ref, {
        done: `Offered the job to ${sent.join(', ')}`,
        waiting: `A caregiver to accept within ${minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`}`,
        next: 'If nobody accepts, the next caregivers on the list are offered the job',
      });
    } else if (proposed) {
      await this.automation.setHandoverNote(ref, {
        done: `Chose ${proposed} caregiver${proposed === 1 ? '' : 's'} to offer the job to`,
        waiting: 'Staff to approve or decline each offer',
        next: 'Send the offers once approved',
      });
    }
    return sent.length || proposed || logged ? 'decided' : 'nothing';
  }

  /** Everyone who passes the hard checks for this request, with what the rules need to know about them. */
  private async candidates(request: RequestRow, match: MatchRequest, exclude: Set<string>, now: Date): Promise<MatchCandidate[]> {
    const travelsToDistrict = exists(
      this.db
        .select({ one: sql`1` })
        .from(preferredLocations)
        .innerJoin(cities, eq(cities.id, preferredLocations.cityId))
        .where(and(eq(preferredLocations.caregiverId, caregivers.id), eq(cities.districtId, match.districtId))),
    );
    const rows = await this.db
      .select({
        id: caregivers.id,
        registrationNumber: caregivers.registrationNumber,
        status: caregivers.status,
        gender: caregivers.gender,
        districtId: caregivers.districtId,
        cityId: caregivers.cityId,
        avail: availability,
      })
      .from(caregivers)
      .leftJoin(availability, eq(availability.caregiverId, caregivers.id))
      .where(
        and(
          isNull(caregivers.deletedAt),
          isNotNull(caregivers.userId),
          inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]),
          or(eq(caregivers.districtId, match.districtId), travelsToDistrict),
          request.genderPreference === 'MALE' || request.genderPreference === 'FEMALE' ? eq(caregivers.gender, request.genderPreference) : undefined,
        ),
      )
      .orderBy(caregivers.registrationNumber)
      .limit(POOL_LIMIT * 2);
    const column = CARE_TYPE_COLUMNS[match.careType as keyof typeof CARE_TYPE_COLUMNS];
    // No availability record yet means nothing has been narrowed down: every kind of care is on (as on the rate card).
    const fit = rows.filter((r) => !exclude.has(r.id) && (r.avail ? Boolean(r.avail[column]) : true)).slice(0, POOL_LIMIT);
    if (!fit.length) return [];
    const ids = fit.map((r) => r.id);

    const startDay = match.desiredStartDate ?? colomboToday(now);
    const [stats, settings, [pricing], rates, travels, running, history] = await Promise.all([
      this.reviewStore.statsFor(ids),
      this.reviewSettings.getResolved(),
      this.db.select().from(careTypePricing).where(eq(careTypePricing.careType, match.careType as CareType)).limit(1),
      this.db.select().from(caregiverRates).where(and(inArray(caregiverRates.caregiverId, ids), eq(caregiverRates.careType, match.careType as CareType))),
      match.cityId
        ? this.db.select({ caregiverId: preferredLocations.caregiverId }).from(preferredLocations).where(and(inArray(preferredLocations.caregiverId, ids), eq(preferredLocations.cityId, match.cityId)))
        : Promise.resolve([] as { caregiverId: string }[]),
      this.db
        .select({ caregiverId: bookings.caregiverId, n: sql<number>`COUNT(*)` })
        .from(bookings)
        .where(and(inArray(bookings.caregiverId, ids), eq(bookings.status, 'CONFIRMED'), lte(bookings.startDate, addDays(startDay, 7)), gte(bookings.endDate, startDay)))
        .groupBy(bookings.caregiverId),
      this.db
        .select({ caregiverId: requestOffers.caregiverId, status: requestOffers.status, n: sql<number>`COUNT(*)` })
        .from(requestOffers)
        .where(and(inArray(requestOffers.caregiverId, ids), gte(requestOffers.createdAt, new Date(now.getTime() - 30 * 86_400_000)), inArray(requestOffers.status, ['DECLINED', 'EXPIRED', 'ACCEPTED'])))
        .groupBy(requestOffers.caregiverId, requestOffers.status),
    ]);
    const rateOf = new Map(rates.map((r) => [r.caregiverId, r.amount]));
    const travelsTo = new Set(travels.map((t) => t.caregiverId));
    const runningOf = new Map(running.map((r) => [r.caregiverId, Number(r.n)]));
    const count = (id: string, statuses: string[]) => history.filter((h) => h.caregiverId === id && statuses.includes(h.status)).reduce((sum, h) => sum + Number(h.n), 0);

    return fit.map((r) => {
      const s = stats.get(r.id);
      const signal = settings.enabled && s ? ratingSignal(s.ratingCount, s.ratingSum, settings.minRatingsToShow) : null;
      const amount = rateOf.get(r.id);
      const usable = pricing && amount !== undefined && rateProblem(amount, pricing) === null;
      const availableFrom = dayOf(r.avail?.availableFrom ?? null);
      return {
        caregiverId: r.id,
        registrationNumber: r.registrationNumber,
        verified: VERIFIED.has(r.status),
        sameCity: match.cityId !== null && r.cityId === match.cityId,
        sameDistrict: r.districtId === match.districtId,
        travelsToCity: travelsTo.has(r.id),
        dayDuty: Boolean(r.avail?.dayDuty),
        nightDuty: Boolean(r.avail?.nightDuty),
        liveIn24h: Boolean(r.avail?.liveIn24h),
        ratingSignal: signal,
        ratingAverage: signal !== null && s ? s.ratingSum / s.ratingCount : null,
        ratingCount: s?.ratingCount ?? 0,
        ownRate: usable ? { amount: amount!, rateType: pricing.rateType } : null,
        availableFrom,
        runningBookings: runningOf.get(r.id) ?? 0,
        recentUnanswered: count(r.id, ['DECLINED', 'EXPIRED']),
        recentAccepted: count(r.id, ['ACCEPTED']),
      } satisfies MatchCandidate;
    });
  }

  /**
   * The rules' order, then - when a model is set up for Matching and there is
   * a real choice to make - the model's view of the top of it. Public for tests.
   */
  async rank(match: MatchRequest, pool: MatchCandidate[]): Promise<{ ranked: RankedMatch[]; model: string | null }> {
    const ranked = rankMatches(match, pool);
    if (ranked.length < 2) return { ranked, model: null };
    // Rates are money, so the list counts as personal data even with nobody named in it.
    if (!(await this.models.candidates('MATCHING', 'PERSONAL')).length) return { ranked, model: null };
    try {
      const [[city], [district]] = await Promise.all([
        match.cityId ? this.db.select({ name: cities.nameEn }).from(cities).where(eq(cities.id, match.cityId)).limit(1) : Promise.resolve([] as { name: string }[]),
        this.db.select({ name: districts.nameEn }).from(districts).where(eq(districts.id, match.districtId)).limit(1),
      ]);
      const prompt = buildRankPrompt({ ...match, cityName: city?.name ?? null, districtName: district?.name ?? null }, pool, ranked);
      const answer = await this.models.chat({
        function: 'MATCHING',
        dataClass: 'PERSONAL',
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        json: true,
        temperature: 0,
        maxTokens: 600,
      });
      return { ranked: applyModelOrder(ranked, answer.content).ranked, model: `${answer.endpointName} (${answer.model})`.slice(0, 100) };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      this.logger.warn(`Matching agent: no model answer (${err.message}); using the rules' order`);
      return { ranked, model: null };
    }
  }

  /** Sends one offer, through the same service the staff page uses. */
  private readonly sendOffer: ActionExecutor = async (decision, actor) => {
    const p = decision.proposal as SendOfferProposal | null;
    if (!p?.requestId || !p.caregiverId) throw new BadRequestException('This proposal has no caregiver to offer the job to');
    const offers = await this.offers.send(p.requestId, { caregiverId: p.caregiverId, expiresInMinutes: p.expiresInMinutes }, { userId: actor.userId });
    const offer = offers.find((o) => o.caregiver.id === p.caregiverId && o.status === 'OFFERED');
    return { offerId: offer?.id ?? null, caregiverRegistration: p.caregiverRegistration, expiresAt: offer?.expiresAt ?? null };
  };

  /**
   * Shadow decisions are scored once staff have chosen: the agent agreed with
   * them when a caregiver staff offered the job to, or attached to the
   * request, is one the agent would have offered it to.
   */
  async scoreShadows(only?: string[]): Promise<number> {
    const open = await this.db
      .select()
      .from(agentDecisions)
      .where(
        and(
          inArray(agentDecisions.action, [RANK, SEND]),
          eq(agentDecisions.outcome, 'SHADOW'),
          isNull(agentDecisions.staffVerdict),
          eq(agentDecisions.caseType, 'REQUEST'),
          only?.length ? inArray(agentDecisions.caseId, only) : undefined,
        ),
      )
      .limit(500);
    if (!open.length) return 0;
    const requestIds = [...new Set(open.map((d) => d.caseId!).filter(Boolean))];
    const agentUser = (await this.automation.agentActor('MATCHING')).userId;
    const [requests, offers] = await Promise.all([
      this.db.select({ id: careRequests.id, caregiverId: careRequests.caregiverId, assignedToUserId: careRequests.assignedToUserId }).from(careRequests).where(inArray(careRequests.id, requestIds)),
      this.db.select({ requestId: requestOffers.requestId, caregiverId: requestOffers.caregiverId, sentByUserId: requestOffers.sentByUserId }).from(requestOffers).where(inArray(requestOffers.requestId, requestIds)),
    ]);
    const chosenIds = new Set<string>([...requests.map((r) => r.caregiverId), ...offers.map((o) => o.caregiverId)].filter((v): v is string => !!v));
    const registration = chosenIds.size
      ? new Map((await this.db.select({ id: caregivers.id, n: caregivers.registrationNumber }).from(caregivers).where(inArray(caregivers.id, [...chosenIds]))).map((c) => [c.id, c.n]))
      : new Map<string, string>();

    let scored = 0;
    for (const requestId of requestIds) {
      const request = requests.find((r) => r.id === requestId);
      const staffOffers = offers.filter((o) => o.requestId === requestId && o.sentByUserId !== agentUser);
      const chosen = new Set<string>([...(request?.caregiverId ? [request.caregiverId] : []), ...staffOffers.map((o) => o.caregiverId)]);
      if (!chosen.size) continue; // staff have not chosen anyone yet
      const mine = open.filter((d) => d.caseId === requestId);
      const wave = new Set(mine.filter((d) => d.action === SEND).map((d) => (d.proposal as SendOfferProposal | null)?.caregiverId));
      const names = [...chosen].map((id) => registration.get(id) ?? 'a caregiver').join(', ');
      const reviewer = staffOffers[0]?.sentByUserId ?? request?.assignedToUserId ?? agentUser;
      for (const d of mine) {
        const set = d.action === SEND ? wave : new Set(((d.proposal as RankProposal | null)?.ranked ?? []).map((r) => r.caregiverId));
        const agreed = [...chosen].some((id) => set.has(id));
        await this.automation.review(
          d.id,
          agreed ? 'AGREED' : 'DIFFERED',
          agreed ? `Scored automatically: staff chose ${names}, who the agent also picked` : `Scored automatically: staff chose ${names}, who the agent did not pick`,
          reviewer,
        );
        scored++;
      }
    }
    return scored;
  }
}
