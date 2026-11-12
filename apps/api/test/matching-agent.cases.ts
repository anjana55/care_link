import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, like, sql } from 'drizzle-orm';
import request from 'supertest';
import type { AutomationOverview, CaregiverCareOffer, StaffCareOffer } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, careRequests, caregivers, jobs, patients } from '../src/database/schema';
import { MATCH_MAX_OFFERS, MatchingAgentService, type RankProposal, type SendOfferProposal } from '../src/matching/matching-agent.service';
import { MATCHING_REQUEST_JOB } from '../src/matching/matching-jobs';
import { AiProviderService, AiUnavailableError } from '../src/ai/ai-provider.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The matching agent over real HTTP and MySQL: it does nothing in Manual,
 * only logs (and scores itself against staff) in Shadow, proposes each offer
 * in Assist, and in Auto keeps three offers waiting until a caregiver accepts.
 * Who it picks follows the rules; a model may only nudge the order and never
 * sees who anyone is.
 *
 * Imported by automation.e2e-spec.ts so both run in one worker: they share
 * the automation settings. Every sweep here names its own requests, and its
 * caregivers live in a district no other suite uses.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Matching agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: MatchingAgentService;
  let intake: Record<string, unknown>;
  let districtId: number;
  let otherDistrictId: number;
  let cityId: number;
  let otherCityId: number;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 2500) % 10_000;
  let n = 0;
  const newPhone = (prefix = '071') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;

  type Cg = { id: string; userId: string; token: string; reg: string; phone: string };
  /** A caregiver living in the test district (same town unless told otherwise), checked by the office unless told otherwise. */
  async function newCaregiver(over: { status?: string; city?: number | null; district?: number; gender?: 'MALE' | 'FEMALE' } = {}): Promise<Cg> {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Matched Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: over.gender ?? 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db
      .update(caregivers)
      .set({ status: (over.status ?? 'ACTIVE') as 'ACTIVE', districtId: over.district ?? districtId, cityId: over.city === undefined ? cityId : over.city })
      .where(eq(caregivers.id, row.id));
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, userId: row.userId!, token, reg: row.registrationNumber, phone };
  }

  /** A phone request for care at home, in the test town, with no caregiver chosen. */
  async function newRequest(over: { careType?: string | null; preference?: 'MALE' | 'FEMALE'; urgency?: string } = {}) {
    const phone = newPhone('077');
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `match-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone, consentAccepted: true, ...intake });
    if (reg.status !== 201) throw new Error(`register-patient: ${JSON.stringify(reg.body)}`);
    if (over.preference || over.urgency) {
      await db
        .update(patients)
        .set({ ...(over.preference ? { preferredCaregiverGender: over.preference } : {}), ...(over.urgency ? { careStart: over.urgency as 'IMMEDIATELY' } : {}) })
        .where(eq(patients.id, reg.body.patientId));
    }
    const careType = over.careType === undefined ? 'HOME_SHIFT' : over.careType;
    const res = await api().post('/care-requests').set(bearer(staffToken)).send({ language: 'en', patientId: reg.body.patientId, careType: careType ?? undefined, message: 'Mother needs help after surgery' }).expect(201);
    return { id: res.body.id as string, reference: res.body.reference as string, phone };
  }

  const mode = (m: string) => api().patch('/settings/automation/functions/MATCHING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const sweep = (...requests: { id: string }[]) => agent.sweep(new Date(), requests.map((r) => r.id));
  const decisionsFor = (requestId: string, action = 'matching.send_offer') =>
    db
      .select()
      .from(agentDecisions)
      .where(and(eq(agentDecisions.caseType, 'REQUEST'), eq(agentDecisions.caseId, requestId), eq(agentDecisions.action, action)))
      .orderBy(agentDecisions.createdAt);
  const offersOn = async (requestId: string) => (await api().get(`/care-requests/${requestId}/offers`).set(bearer(staffToken)).expect(200)).body as StaffCareOffer[];
  const offered = async (requestId: string, status = 'OFFERED') => (await offersOn(requestId)).filter((o) => o.status === status).map((o) => o.caregiver.registrationNumber).sort();
  const mine = async (cg: Cg) => (await api().get('/me/care-offers').set(bearer(cg.token)).expect(200)).body as CaregiverCareOffer[];
  const panel = async (requestId: string) => (await api().get(`/automation/cases/REQUEST/${requestId}`).set(bearer(staffToken)).expect(200)).body;
  const regs = (...cgs: Cg[]) => cgs.map((c) => c.reg).sort();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(MatchingAgentService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    // The last district in the list: the other suites all use the first.
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const all = tree.flatMap((p) => p.districts);
    districtId = all[all.length - 1].id;
    otherDistrictId = all[all.length - 2].id;
    const towns = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body as { id: number }[];
    [cityId, otherCityId] = [towns[0].id, towns[1].id];
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
  });

  // Each test starts with nobody living in the test district: caregivers from earlier tests (and earlier runs) move out.
  beforeEach(async () => {
    await db.update(caregivers).set({ districtId: null, cityId: null }).where(and(eq(caregivers.districtId, districtId), like(caregivers.fullName, 'Matched Caregiver %')));
  });

  afterAll(async () => {
    await mode('MANUAL');
    await db.update(caregivers).set({ districtId: null, cityId: null }).where(and(eq(caregivers.districtId, districtId), like(caregivers.fullName, 'Matched Caregiver %')));
    await app.close();
  });

  it('does nothing while Matching is Manual', async () => {
    await mode('MANUAL');
    await newCaregiver();
    const req = await newRequest();
    expect(await sweep(req)).toMatchObject({ function: 'MATCHING', mode: 'MANUAL', considered: 0, decided: 0 });
    expect(await decisionsFor(req.id)).toHaveLength(0);
    expect(await offersOn(req.id)).toHaveLength(0);
    // Nothing is even queued for the agent while it is switched off.
    expect(await db.select().from(jobs).where(and(eq(jobs.type, MATCHING_REQUEST_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.requestId') = ${req.id}`))).toHaveLength(0);
  });

  it('in Auto, offers the job to the three who fit best, then to the next when one says no, and stops when one accepts', async () => {
    await mode('AUTO');
    const best = await newCaregiver(); // checked, same town
    const near = await newCaregiver({ city: otherCityId }); // checked, same district
    const unchecked = await newCaregiver({ status: 'REGISTERED' }); // same town, not yet checked
    const last = await newCaregiver({ status: 'REGISTERED', city: otherCityId });
    const elsewhere = await newCaregiver({ district: otherDistrictId, city: null });
    const draft = await newCaregiver({ status: 'DRAFT' }); // not listed yet
    const req = await newRequest();

    expect(await sweep(req)).toMatchObject({ mode: 'AUTO', considered: 1, decided: 1, leftToStaff: 0 });
    expect(await offered(req.id)).toEqual(regs(best, near, unchecked));
    expect(await mine(elsewhere)).toHaveLength(0);
    expect(await mine(draft)).toHaveLength(0);

    // The ranking is on the record, best first, with a reason for every point and nobody's name.
    const [ranking] = await decisionsFor(req.id, 'matching.rank_caregivers');
    const ranked = (ranking.proposal as RankProposal).ranked;
    expect(ranking).toMatchObject({ outcome: 'EXECUTED', model: null });
    expect(ranking.executedAt).toBeTruthy();
    expect(ranked.map((r) => r.registrationNumber)).toEqual([best.reg, near.reg, unchecked.reg, last.reg]);
    expect(ranked[0].reasons).toEqual(['Checked by the office', 'Lives in the same town']);
    expect((ranking.proposal as RankProposal).rankedBy).toBe('rules');
    const sends = await decisionsFor(req.id);
    expect(sends).toHaveLength(3);
    expect(sends.every((d) => d.outcome === 'EXECUTED' && d.executedAt && !d.executionError)).toBe(true);
    const logged = JSON.stringify([ranking, ...sends]);
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Matched Caregiver', req.phone, best.phone, 'surgery']) expect(logged).not.toContain(secret);

    // WITHIN_WEEK: four hours to answer. Sent as the agent, and the case says what happens next.
    const [offer] = await mine(best);
    expect(new Date(offer.expiresAt).getTime() - new Date(offer.createdAt).getTime()).toBe(4 * 3_600_000);
    expect((await offersOn(req.id))[0].sentByName).toMatch(/Matching agent \(automated\)/);
    const note = (await panel(req.id)).handoverNote;
    expect(note.done).toContain(best.reg);
    expect(note.waiting).toBe('A caregiver to accept within 4 hours');

    // Nothing changes on a second look while three are waiting.
    expect(await sweep(req)).toMatchObject({ considered: 1, decided: 0 });
    expect(await decisionsFor(req.id)).toHaveLength(3);

    // One says no: the agent is asked to look again, and offers the job to the next on the list.
    await api().post(`/me/care-offers/${offer.id}/decline`).set(bearer(best.token)).send({ reason: 'TOO_FAR' }).expect(200);
    const nudges = await db.select().from(jobs).where(and(eq(jobs.type, MATCHING_REQUEST_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.requestId') = ${req.id}`));
    expect(nudges).toHaveLength(2); // one when the request came in, one for this answer
    expect(await sweep(req)).toMatchObject({ decided: 1 });
    expect(await offered(req.id)).toEqual(regs(near, unchecked, last));

    // One accepts: they get the job, the others are told it is gone, and the agent hands the booking to staff.
    const [theirs] = await mine(near);
    await api().post(`/me/care-offers/${theirs.id}/accept`).set(bearer(near.token)).expect(200);
    const [after] = await db.select().from(careRequests).where(eq(careRequests.id, req.id));
    expect(after.caregiverId).toBe(near.id);
    expect(await offered(req.id)).toEqual([]);
    expect(await sweep(req)).toMatchObject({ considered: 1, decided: 0 });
    expect((await panel(req.id)).handoverNote.waiting).toBe('Staff to make the booking; the agreed rates are filled in');
    expect(await decisionsFor(req.id)).toHaveLength(4);
  });

  it('keeps to a stated preference, gives an urgent request one hour, and leaves to staff what it cannot match', async () => {
    await mode('AUTO');
    const woman = await newCaregiver({ status: 'REGISTERED' });
    const man = await newCaregiver({ gender: 'MALE' });
    const urgent = await newRequest({ preference: 'FEMALE', urgency: 'IMMEDIATELY' });
    await sweep(urgent);
    expect(await offered(urgent.id)).toEqual([woman.reg]);
    const [offer] = await mine(woman);
    expect(new Date(offer.expiresAt).getTime() - new Date(offer.createdAt).getTime()).toBe(3_600_000);
    expect(await mine(man)).toHaveLength(0);

    // No kind of care on the request: a person has to ask the client first.
    const vague = await newRequest({ careType: null });
    expect(await sweep(vague)).toMatchObject({ considered: 1, decided: 0, leftToStaff: 1 });
    expect((await panel(vague.id)).handoverNote.waiting).toBe('Staff: the request does not say what kind of care is needed');

    // Only browsing: not offered to anyone.
    const browsing = await newRequest({ urgency: 'JUST_EXPLORING' });
    expect(await sweep(browsing)).toMatchObject({ decided: 0, leftToStaff: 0 });
    expect(await offersOn(browsing.id)).toHaveLength(0);

    // Everyone who fits has said no: back to staff, with the reason.
    await api().post(`/me/care-offers/${offer.id}/decline`).set(bearer(woman.token)).send({}).expect(200);
    expect(await sweep(urgent)).toMatchObject({ decided: 0, leftToStaff: 1 });
    expect((await panel(urgent.id)).handoverNote.done).toBe('Offered the job to everyone who fits (1); nobody accepted');
    expect(MATCH_MAX_OFFERS).toBe(9);
  });

  it('stays away from a request a staff member has taken over', async () => {
    await mode('AUTO');
    await newCaregiver();
    const req = await newRequest();
    await api().post(`/automation/cases/REQUEST/${req.id}/take-over`).set(bearer(staffToken)).send({ reason: 'The family asked for someone they know' }).expect(200);
    expect(await sweep(req)).toMatchObject({ considered: 1, decided: 0 });
    expect(await offersOn(req.id)).toHaveLength(0);
    await api().post(`/automation/cases/REQUEST/${req.id}/hand-back`).set(bearer(staffToken)).expect(200);
    expect(await sweep(req)).toMatchObject({ decided: 1 });
    expect(await offersOn(req.id)).toHaveLength(1);
  });

  it('in Assist, proposes each offer; approving sends it under the staff member, declining is final', async () => {
    await mode('ASSIST');
    const a = await newCaregiver();
    const b = await newCaregiver({ city: otherCityId });
    const c = await newCaregiver({ status: 'REGISTERED' });
    const d = await newCaregiver({ status: 'REGISTERED', city: otherCityId });
    const req = await newRequest();

    expect(await sweep(req)).toMatchObject({ mode: 'ASSIST', decided: 1 });
    expect(await offersOn(req.id)).toHaveLength(0);
    const proposals = await decisionsFor(req.id);
    expect(proposals.map((p) => [p.outcome, (p.proposal as SendOfferProposal).caregiverRegistration])).toEqual([['PROPOSED', a.reg], ['PROPOSED', b.reg], ['PROPOSED', c.reg]]);
    expect(proposals[0].reason).toBe(`Offer the job to ${a.reg}: Checked by the office; Lives in the same town`);
    expect((await panel(req.id)).handoverNote.waiting).toBe('Staff to approve or decline each offer');
    const waiting = (await api().get('/automation/decisions?awaitingStaff=true&pageSize=100').set(bearer(staffToken)).expect(200)).body as { id: string }[];
    expect(waiting.map((w) => w.id)).toEqual(expect.arrayContaining(proposals.map((p) => p.id)));

    await api().post(`/automation/decisions/${proposals[0].id}/approve`).set(bearer(staffToken)).expect(200);
    expect(await offered(req.id)).toEqual([a.reg]);
    expect((await offersOn(req.id))[0].sentByName).not.toMatch(/agent/i);
    await api().post(`/automation/decisions/${proposals[1].id}/decline`).set(bearer(staffToken)).send({ note: 'On leave this month' }).expect(200);

    // One waiting, one still proposed: room for one more, and it is not the caregiver staff turned down.
    await sweep(req);
    const now = await decisionsFor(req.id);
    expect(now).toHaveLength(4);
    expect((now[3].proposal as SendOfferProposal).caregiverRegistration).toBe(d.reg);
    await sweep(req);
    expect(await decisionsFor(req.id)).toHaveLength(4);
    expect(await mine(b)).toHaveLength(0);
  });

  it('in Shadow, only logs, then scores itself against who staff chose', async () => {
    await mode('SHADOW');
    const a = await newCaregiver();
    const b = await newCaregiver({ city: otherCityId });
    const c = await newCaregiver({ status: 'REGISTERED' });
    const d = await newCaregiver({ status: 'REGISTERED', city: otherCityId });
    const agreed = await newRequest();
    const differed = await newRequest();

    expect(await sweep(agreed, differed)).toMatchObject({ mode: 'SHADOW', considered: 2, decided: 2, scored: 0 });
    expect(await offersOn(agreed.id)).toHaveLength(0);
    expect((await decisionsFor(agreed.id)).map((x) => [x.outcome, (x.proposal as SendOfferProposal).caregiverRegistration])).toEqual([['SHADOW', a.reg], ['SHADOW', b.reg], ['SHADOW', c.reg]]);
    // Looking again logs nothing new and scores nothing: staff have not chosen yet.
    expect(await sweep(agreed, differed)).toMatchObject({ decided: 0, scored: 0 });
    expect(await decisionsFor(agreed.id)).toHaveLength(3);

    // Staff offer one request to the agent's first pick, the other to someone it ranked fourth.
    await api().post(`/care-requests/${agreed.id}/offers`).set(bearer(staffToken)).send({ caregiverId: a.id }).expect(201);
    await api().post(`/care-requests/${differed.id}/offers`).set(bearer(staffToken)).send({ caregiverId: d.id }).expect(201);
    expect(await sweep(agreed, differed)).toMatchObject({ scored: 8 });

    expect((await decisionsFor(agreed.id)).map((x) => x.staffVerdict)).toEqual(['AGREED', 'AGREED', 'AGREED']);
    const missed = await decisionsFor(differed.id);
    expect(missed.map((x) => x.staffVerdict)).toEqual(['DIFFERED', 'DIFFERED', 'DIFFERED']);
    expect(missed[0].staffNote).toBe(`Scored automatically: staff chose ${d.reg}, who the agent did not pick`);
    // The ranking itself did include that caregiver.
    expect((await decisionsFor(differed.id, 'matching.rank_caregivers'))[0].staffVerdict).toBe('AGREED');

    const overview = (await api().get('/settings/automation').set(bearer(adminToken)).expect(200)).body as AutomationOverview;
    const send = overview.functions.flatMap((f) => f.actions).find((x) => x.key === 'matching.send_offer')!;
    expect(send.record.judged).toBeGreaterThanOrEqual(6);
  });

  describe('with an AI model set up', () => {
    let chat: jest.SpyInstance;
    const endpoint = (clearedFor: string) => ({ name: `Matching model ${run}-${++n}`, provider: 'OLLAMA', baseUrl: 'http://10.0.0.5:11434', model: 'qwen2.5:14b', clearedFor });
    async function useModel(clearedFor: string) {
      const body = endpoint(clearedFor);
      const o = (await api().post('/settings/automation/endpoints').set(bearer(adminToken)).send(body).expect(201)).body as AutomationOverview;
      const id = o.endpoints.find((e) => e.name === body.name)!.id;
      await api().patch('/settings/automation/functions/MATCHING/endpoints').set(bearer(adminToken)).send({ endpointId: id, fallbackEndpointId: null }).expect(200);
    }

    beforeEach(() => {
      chat = jest.spyOn(app.get(AiProviderService), 'chat');
    });
    afterEach(async () => {
      chat.mockRestore();
      await api().patch('/settings/automation/functions/MATCHING/endpoints').set(bearer(adminToken)).send({ endpointId: null, fallbackEndpointId: null }).expect(200);
    });

    it('lets the model move people a place or two, and shows it nothing that says who anyone is', async () => {
      await mode('AUTO');
      await useModel('PERSONAL');
      const a = await newCaregiver();
      const b = await newCaregiver({ city: otherCityId });
      const c = await newCaregiver({ status: 'REGISTERED' });
      const d = await newCaregiver({ status: 'REGISTERED', city: otherCityId });
      const req = await newRequest();
      chat.mockResolvedValue({ content: '{"order":["C1","C2","C4","C3"],"reasons":{"C4":"Lives nearer the bus route"}}', toolCalls: [] });

      await sweep(req);
      expect(chat).toHaveBeenCalledTimes(1);
      const sent = JSON.stringify(chat.mock.calls[0][1]);
      for (const cg of [a, b, c, d]) for (const secret of [cg.reg, cg.id, cg.phone, cg.userId]) expect(sent).not.toContain(secret);
      for (const secret of ['Nimal', 'Perera', 'Sunil', 'Fernando', 'Matched Caregiver', req.phone, req.reference, req.id, 'surgery', 'bathing']) expect(sent).not.toContain(secret);
      expect(sent).toContain('HOME_SHIFT');

      expect(await offered(req.id)).toEqual(regs(a, b, d));
      const [ranking] = await decisionsFor(req.id, 'matching.rank_caregivers');
      expect(ranking.model).toMatch(/^Matching model .* \(qwen2\.5:14b\)$/);
      expect(ranking.promptVersion).toBe('matching-rank-v1');
      const ranked = (ranking.proposal as RankProposal).ranked;
      expect((ranking.proposal as RankProposal).rankedBy).toBe('rules+model');
      expect(ranked.map((r) => r.registrationNumber)).toEqual([a.reg, b.reg, d.reg, c.reg]);
      expect(ranked[2].reasons.at(-1)).toBe('AI: Lives nearer the bus route');
    });

    it("carries on with the rules' order when the model fails or answers nonsense", async () => {
      await mode('AUTO');
      await useModel('PERSONAL');
      const a = await newCaregiver();
      const b = await newCaregiver({ city: otherCityId });
      const down = await newRequest();
      chat.mockRejectedValue(new AiUnavailableError('connection refused'));
      await sweep(down);
      expect(await offered(down.id)).toEqual(regs(a, b));
      expect((await decisionsFor(down.id, 'matching.rank_caregivers'))[0].model).toBeNull();

      const nonsense = await newRequest();
      chat.mockResolvedValue({ content: 'Offer it to Kamala on 0771234567', toolCalls: [] });
      await sweep(nonsense);
      const ranked = ((await decisionsFor(nonsense.id, 'matching.rank_caregivers'))[0].proposal as RankProposal).ranked;
      expect(ranked.map((r) => r.registrationNumber)).toEqual([a.reg, b.reg]);
      expect(JSON.stringify(ranked)).not.toContain('Kamala');
    });

    it('does not send the list to a model cleared for public data only', async () => {
      await mode('AUTO');
      await useModel('PUBLIC');
      const a = await newCaregiver();
      const b = await newCaregiver({ city: otherCityId });
      const req = await newRequest();
      await sweep(req);
      expect(chat).not.toHaveBeenCalled();
      expect(await offered(req.id)).toEqual(regs(a, b));
    });
  });
});
