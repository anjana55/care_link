import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, type ClientCareRequest } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, careRequests, patients } from '../src/database/schema';
import { IntakeAgentService } from '../src/intake/intake-agent.service';
import { INTAKE_REQUEST_JOB } from '../src/intake/intake-jobs';
import { JobsService } from '../src/jobs/jobs.service';
import { StaffAlertsService } from '../src/email/staff-alerts.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The intake agent over real HTTP and MySQL: it finds what an open request
 * is missing for matching and a booking, asks the client once, takes their
 * answer, and hands the request on - or back to staff when nobody answers.
 *
 * Imported by automation.e2e-spec.ts (shared automation settings). Every
 * sweep names its own requests.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Intake agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: IntakeAgentService;
  let districtId: number;
  let cityId: number;
  let notify: jest.SpyInstance;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 5200) % 10_000;
  let n = 0;
  const newPhone = () => `077${String(run * 1000 + ++n).padStart(7, '0')}`;
  const ASK = 'intake.ask_client';

  /** A client who signed up "not sure" about the time of day, and a "find someone for me" request with no start date. */
  async function newRequest(over: { careStart?: string; careSchedule?: string } = {}) {
    const reg = await api()
      .post('/auth/register-patient')
      .send({
        email: `intake-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone(), consentAccepted: true,
        registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
        preferredContactMethod: 'WHATSAPP', districtId, cityId, careNeeds: 'Needs help with bathing and meals.',
        careSchedule: over.careSchedule ?? 'NOT_SURE', careStart: over.careStart ?? 'WITHIN_WEEK',
      })
      .expect(201);
    const [p] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: p.userId, role: 'PATIENT_GUARDIAN', patientId: p.id }, { secret: accessSecret, expiresIn: '10m' });
    const res = await api().post('/me/care-requests').set(bearer(token)).send({ careType: 'HOME_SHIFT', districtId, cityId }).expect(201);
    return { id: res.body.id as string, reference: res.body.reference as string, token, userId: p.userId };
  }
  type Req = Awaited<ReturnType<typeof newRequest>>;

  const mode = (m: string) => api().patch('/settings/automation/functions/INTAKE').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const sweep = (r: Req, at = new Date()) => agent.sweep(at, [r.id]);
  const decisions = (r: Req) => db.select().from(agentDecisions).where(and(eq(agentDecisions.caseId, r.id), eq(agentDecisions.action, ASK))).orderBy(agentDecisions.createdAt);
  const mine = async (r: Req) => ((await api().get('/me/care-requests').set(bearer(r.token)).expect(200)).body as ClientCareRequest[]).find((x) => x.id === r.id)!;
  const staffView = async (r: Req) => (await api().get(`/care-requests/${r.id}`).set(bearer(staffToken)).expect(200)).body;
  const note = async (r: Req) => (await api().get(`/automation/cases/REQUEST/${r.id}`).set(bearer(staffToken)).expect(200)).body.handoverNote;
  const answer = (r: Req, body: object) => api().patch(`/me/care-requests/${r.id}/details`).set(bearer(r.token)).send(body);
  const told = (r: Req) => notify.mock.calls.filter((c) => c[3] === `intake ask ${r.id}`);
  const inDays = (d: number) => addDays(colomboToday(), d);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(IntakeAgentService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    districtId = tree.flatMap((p) => p.districts)[2].id;
    cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
    await mode('MANUAL');
  });
  beforeEach(() => {
    notify = jest.spyOn(app.get(NotificationsService), 'notify');
  });
  afterEach(() => notify.mockRestore());
  afterAll(async () => {
    await mode('MANUAL');
    await app.close();
  });

  it('does nothing in Manual, and staff see what the request is missing', async () => {
    await mode('MANUAL');
    const r = await newRequest();
    expect(await sweep(r)).toMatchObject({ mode: 'MANUAL', considered: 0 });
    expect(await decisions(r)).toHaveLength(0);
    expect((await staffView(r)).intake).toEqual({ gaps: ['SCHEDULE', 'START_DATE'], asked: null, answeredAt: null });
    expect((await mine(r)).detailsNeeded).toEqual([]);
  });

  it('Auto: asks the client once for what is missing, takes their answer, and hands the request on', async () => {
    await mode('AUTO');
    const r = await newRequest();
    // A new request queues the agent.
    await app.get(JobsService).runDue(new Date(), [INTAKE_REQUEST_JOB]);
    const [d] = await decisions(r);
    expect(d).toMatchObject({ outcome: 'EXECUTED', tier: 1, executionError: null, reason: 'Ask the client for the time of day, the start date: matching and the booking need them' });
    const msg = told(r);
    expect(msg).toHaveLength(1);
    expect(msg[0][0]).toEqual([r.userId]);
    expect(msg[0][2]).toBe(`/requests/${r.id}`);
    const words = (msg[0][1] as (l: 'en') => { title: string; body: string })('en');
    expect(words).toEqual({ title: 'A few details for your request', body: `To find your caregiver we need: the time of day, the start date. It takes a minute - open your request ${r.reference}.` });
    expect(JSON.stringify(words)).not.toMatch(/bathing|meals|Sunil/);
    expect((await mine(r)).detailsNeeded).toEqual(['SCHEDULE', 'START_DATE']);
    expect((await staffView(r)).intake).toMatchObject({ gaps: ['SCHEDULE', 'START_DATE'], asked: { gaps: ['SCHEDULE', 'START_DATE'] }, answeredAt: null });
    expect(await note(r)).toMatchObject({ done: 'Asked the client for the time of day, the start date' });
    // Asked once only.
    await sweep(r);
    expect(await decisions(r)).toHaveLength(1);
    expect(told(r)).toHaveLength(1);

    // What was asked for is required; the date must be sensible.
    expect((await answer(r, { schedule: 'NIGHT' }).expect(400)).body.message).toBe('Enter a valid start date');
    expect((await answer(r, { desiredStartDate: inDays(3) }).expect(400)).body.message).toBe('Choose when in the day care is needed');
    expect((await answer(r, { schedule: 'NIGHT', desiredStartDate: inDays(-1) }).expect(400)).body.message).toBe('Enter a start date from today, within a year');
    await answer(r, { schedule: 'NOT_SURE', desiredStartDate: inDays(3) }).expect(400);
    const done = (await answer(r, { schedule: 'NIGHT', desiredStartDate: inDays(3) }).expect(200)).body as ClientCareRequest;
    expect(done).toMatchObject({ schedule: 'NIGHT', desiredStartDate: inDays(3), detailsNeeded: [] });
    const staff = await staffView(r);
    expect(staff.intake).toMatchObject({ gaps: [], answeredAt: expect.any(String) });
    expect(staff.events.some((e: { note: string | null }) => e.note === `The client added: time of day NIGHT, start ${inDays(3)}`)).toBe(true);

    // The answer queued the agent: the request is complete and goes to matching.
    await app.get(JobsService).runDue(new Date(), [INTAKE_REQUEST_JOB]);
    expect(await note(r)).toMatchObject({ done: 'The client filled in what the request was missing', waiting: 'Matching to find a caregiver' });
    expect(await decisions(r)).toHaveLength(1);
  });

  it('goes back to staff, once, when the client does not answer in two days', async () => {
    await mode('AUTO');
    const r = await newRequest();
    const alerts = jest.spyOn(app.get(StaffAlertsService), 'tell');
    const reminded = () => notify.mock.calls.filter((c) => c[3] === `intake remind ${r.id}`);
    await sweep(r);
    expect(await sweep(r, new Date(Date.now() + 23 * 3_600_000))).toMatchObject({ leftToStaff: 0 });
    expect(reminded()).toHaveLength(0);
    // One reminder after a day.
    await sweep(r, new Date(Date.now() + 25 * 3_600_000));
    expect(reminded()).toHaveLength(1);
    expect(reminded()[0][0]).toEqual([r.userId]);
    expect((reminded()[0][1] as (l: 'en') => { title: string; body: string })('en')).toEqual({
      title: 'Reminder: details for your request',
      body: `We still need the time of day, the start date to find your caregiver. Open your request ${r.reference} - it takes a minute.`,
    });
    expect(await note(r)).toMatchObject({ done: 'Asked the client for the time of day, the start date, and reminded them once' });
    expect((await staffView(r)).events.some((e: { note: string | null }) => e.note === 'Reminded the client about the time of day, the start date')).toBe(true);
    await sweep(r, new Date(Date.now() + 30 * 3_600_000));
    expect(reminded()).toHaveLength(1);
    expect(await sweep(r, new Date(Date.now() + 47 * 3_600_000))).toMatchObject({ leftToStaff: 0 });
    expect(alerts).not.toHaveBeenCalled();
    // Then staff, by bell and email, once.
    expect(await sweep(r, new Date(Date.now() + 49 * 3_600_000))).toMatchObject({ leftToStaff: 1 });
    expect(await note(r)).toMatchObject({ waiting: 'Staff: no answer - phone the client for the time of day, the start date' });
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(alerts.mock.calls[0][0]).toMatchObject({
      subject: `No answer on request ${r.reference}`,
      paragraphs: ['The client was asked for the time of day, the start date two days ago, and reminded once, and has not answered - phone them.', expect.any(String)],
      path: `/requests/${r.id}`,
    });
    expect(JSON.stringify(alerts.mock.calls[0][0])).not.toMatch(/bathing|meals|Sunil|Nimal/);
    expect(await sweep(r, new Date(Date.now() + 60 * 3_600_000))).toMatchObject({ leftToStaff: 0 });
    expect(alerts).toHaveBeenCalledTimes(1);
    alerts.mockRestore();
    // The client can still answer later.
    await answer(r, { schedule: 'DAY', desiredStartDate: inDays(5) }).expect(200);
  });

  it('Assist proposes the question; approving sends it', async () => {
    await mode('ASSIST');
    const r = await newRequest();
    await sweep(r);
    const [d] = await decisions(r);
    expect(d).toMatchObject({ outcome: 'PROPOSED' });
    expect(told(r)).toHaveLength(0);
    expect((await mine(r)).detailsNeeded).toEqual([]);
    await api().post(`/automation/decisions/${d.id}/approve`).set(bearer(staffToken)).expect(200);
    expect(told(r)).toHaveLength(1);
    expect((await mine(r)).detailsNeeded).toEqual(['SCHEDULE', 'START_DATE']);
  });

  it('Shadow only logs, and is scored by whether staff filled the same gaps', async () => {
    await mode('SHADOW');
    const [a, b] = [await newRequest(), await newRequest()];
    await sweep(a);
    await sweep(b);
    expect(told(a)).toHaveLength(0);
    expect((await decisions(a))[0]).toMatchObject({ outcome: 'SHADOW', staffVerdict: null });
    // Staff phoned the first client and filled both in; the second request was closed without them.
    await db.update(careRequests).set({ schedule: 'DAY', desiredStartDate: inDays(4) }).where(eq(careRequests.id, a.id));
    await api().patch(`/care-requests/${b.id}/status`).set(bearer(staffToken)).send({ status: 'CLOSED', closeReason: 'CLIENT_NOT_PROCEEDING' }).expect(200);
    await agent.scoreShadows([a.id, b.id]);
    expect((await decisions(a))[0]).toMatchObject({ staffVerdict: 'AGREED' });
    expect((await decisions(b))[0]).toMatchObject({ staffVerdict: 'DIFFERED' });
  });

  it('leaves alone a client who is just exploring, a complete request, and another client', async () => {
    await mode('AUTO');
    const exploring = await newRequest({ careStart: 'JUST_EXPLORING' });
    await sweep(exploring);
    expect(await decisions(exploring)).toHaveLength(0);
    const complete = await newRequest({ careSchedule: 'DAY' });
    await db.update(careRequests).set({ desiredStartDate: inDays(6) }).where(eq(careRequests.id, complete.id));
    await sweep(complete);
    expect(await decisions(complete)).toHaveLength(0);
    // Someone else's request answers as one that does not exist.
    await api().patch(`/me/care-requests/${complete.id}/details`).set(bearer(exploring.token)).send({ schedule: 'DAY' }).expect(404);
  });
});
