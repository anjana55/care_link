import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, caregiverDocuments, caregivers, jobs, references } from '../src/database/schema';
import { OnboardingAgentService } from '../src/onboarding/onboarding-agent.service';
import { ONBOARDING_CAREGIVER_JOB } from '../src/onboarding/onboarding-jobs';
import { NotificationsService } from '../src/notifications/notifications.service';
import { EmailService } from '../src/email/email.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The onboarding agent over real HTTP and MySQL: it keeps an applicant's
 * verification file, asks them for missing documents, asks their referees to
 * confirm them through a one-time link, and tells staff when the file is ready
 * or something is not coming - and never verifies anyone.
 *
 * Imported by automation.e2e-spec.ts (shared automation settings). Every
 * sweep names its own caregivers.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Onboarding agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let staffToken: string;
  let adminToken: string;
  let agent: OnboardingAgentService;
  let notify: jest.SpyInstance;
  let mail: jest.SpyInstance;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 7300) % 10_000;
  let n = 0;
  const newPhone = () => `079${String(run * 1000 + ++n).padStart(7, '0')}`; // 079: no other suite uses it
  const DAY = 86_400_000;

  /** An applicant who has registered: profile complete, no documents, two referees with email addresses. */
  async function newApplicant(over: { referees?: number; refereeEmail?: boolean } = {}) {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Kamala Applicant ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    await db.update(caregivers).set({ status: 'REGISTERED', nic: `88${String(run * 1000 + n).padStart(7, '0')}V`, districtId: tree[0].districts[0].id }).where(eq(caregivers.id, row.id));
    for (let i = 0; i < (over.referees ?? 2); i++) {
      await api()
        .post(`/caregivers/${row.id}/references`)
        .set(bearer(staffToken))
        .send({ name: `Referee${i} Silva`, relationship: 'Former employer', phone: newPhone(), ...(over.refereeEmail === false ? {} : { email: `referee-${run}-${n}-${i}@example.com` }) })
        .expect(201);
    }
    return { id: row.id, userId: row.userId!, reg: row.registrationNumber, name: row.fullName };
  }
  type Cg = Awaited<ReturnType<typeof newApplicant>>;

  const mode = (m: string) => api().patch('/settings/automation/functions/ONBOARDING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const sweep = (c: Cg, at = new Date()) => agent.sweep(at, [c.id]);
  const decisions = (c: Cg, action: string) => db.select().from(agentDecisions).where(and(eq(agentDecisions.caseId, c.id), eq(agentDecisions.action, action))).orderBy(agentDecisions.createdAt);
  const file = async (c: Cg) => (await api().get(`/caregivers/${c.id}/onboarding-file`).set(bearer(staffToken)).expect(200)).body.file;
  const asked = (c: Cg) => notify.mock.calls.filter((x) => x[3] === `onboarding docs ${c.id}`);
  /** The referee emails for this caregiver, Referee0's first. */
  const links = (c: Cg) =>
    mail.mock.calls
      .filter((x) => String(x[2]).startsWith('reference '))
      .map((x) => ({ to: String(x[0]), ...(x[1] as { cta: { url: string }; blocks: { paragraphs: string[] }[] }) }))
      .filter((p) => p.blocks[0].paragraphs[0].includes(c.name))
      .sort((a, b) => Number(a.to.split('@')[0].split('-').pop()) - Number(b.to.split('@')[0].split('-').pop()));
  const tokenOf = (url: string) => new URL(url).searchParams.get('token')!;
  const staffMail = (subject: string) => mail.mock.calls.filter((x) => (x[1] as { subject: string }).subject === subject);
  const addDocs = (c: Cg, types = ['NIC', 'POLICE_CLEARANCE', 'GRAMA_NILADHARI_CERTIFICATE']) =>
    db.insert(caregiverDocuments).values(
      types.map((t) => {
        const id = uuid();
        return { id, caregiverId: c.id, documentType: t as 'NIC', storageKey: `${c.id}/${id}/original-file.pdf`, originalFilename: `${t}.pdf`, mimeType: 'application/pdf', sizeBytes: 10, checksum: 'x'.repeat(64) };
      }),
    );
  const answer = (token: string, body: object) => api().post('/public/references/answer').send({ token, ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    agent = app.get(OnboardingAgentService);
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
    await mode('MANUAL');
  });
  beforeEach(() => {
    notify = jest.spyOn(app.get(NotificationsService), 'notify');
    mail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue(undefined);
  });
  afterEach(() => {
    notify.mockRestore();
    mail.mockRestore();
  });
  afterAll(async () => {
    await mode('MANUAL');
    await app.close();
  });

  it('does nothing in Manual', async () => {
    await mode('MANUAL');
    const c = await newApplicant();
    expect(await sweep(c)).toMatchObject({ mode: 'MANUAL', considered: 0 });
    expect(await file(c)).toBeNull();
    expect(asked(c)).toHaveLength(0);
    expect(links(c)).toHaveLength(0);
  });

  it('Auto: assembles the file, asks for documents, asks referees, and tells staff once it is ready - never verifying', async () => {
    await mode('AUTO');
    const c = await newApplicant();
    // Adding the references queued the agent for this caregiver (other runs may have left jobs queued, so run it here).
    const queued = await db.select({ payload: jobs.payload }).from(jobs).where(and(eq(jobs.type, ONBOARDING_CAREGIVER_JOB), eq(jobs.status, 'PENDING')));
    expect(queued.some((j) => (j.payload as { caregiverId?: string }).caregiverId === c.id)).toBe(true);
    await sweep(c);

    const f = await file(c);
    expect(f.recommendation).toBe('NOT_READY');
    expect(f.checks.map((x: { key: string; state: string }) => `${x.key}:${x.state}`)).toEqual(['IDENTITY:MISSING', 'POLICE:MISSING', 'GN:MISSING', 'PROFILE:OK', 'REFERENCES:WAITING']);
    expect(f.documentsRequested.documents).toEqual(['identity', 'police', 'gn']);

    // The caregiver: which documents, and where to upload them.
    const [msg] = asked(c);
    expect(msg[0]).toEqual([c.userId]);
    expect(msg[2]).toBe('/documents');
    expect((msg[1] as (l: 'en') => { body: string })('en').body).toBe('To finish checking your registration we need: your NIC or passport, a police clearance certificate, a Grama Niladhari certificate. Please upload them under Documents.');

    // Each referee: one email, a link, nothing about the caregiver but their name.
    const sent = links(c);
    expect(sent).toHaveLength(2);
    expect(sent[0].blocks.map((b) => b.paragraphs[0])[0]).toBe(`${c.name} gave your name as a reference (Former employer) when applying to work as a caregiver with us. Could you answer three short questions?`);
    expect(JSON.stringify(sent[0])).not.toMatch(/Lake Road|1988|0770001111/);
    expect(f.references.map((r: { channel: string; sentAt: string | null }) => r.channel)).toEqual(['EMAIL', 'EMAIL']);
    const [t1, t2] = sent.map((s) => tokenOf(s.cta.url));
    // Only a hash of the token is stored.
    const stored = await db.select().from(references).where(eq(references.caregiverId, c.id));
    expect(JSON.stringify(stored)).not.toContain(t1);

    // Asked once only.
    await sweep(c);
    expect(asked(c)).toHaveLength(1);
    expect(links(c)).toHaveLength(2);

    // The referee's page.
    expect((await api().post('/public/references/check').send({ token: t1 }).expect(200)).body).toEqual({ caregiverName: c.name, relationship: 'Former employer', refereeName: 'Referee0', answered: false });
    await api().post('/public/references/check').send({ token: 'x'.repeat(43) }).expect(404);
    expect((await answer(t1, { knowsThem: true }).expect(400)).body.message).toBe('Answer each question');
    await answer(t1, { knowsThem: true, years: 'FOREVER', wouldTrust: 'YES' }).expect(400);
    await answer(t1, { knowsThem: true, years: 'OVER_3', wouldTrust: 'YES', comment: '  Looked after my father for four years.  ' }).expect(200);
    await answer(t1, { knowsThem: true, years: 'OVER_3', wouldTrust: 'YES' }).expect(409);
    expect((await api().post('/public/references/check').send({ token: t1 }).expect(200)).body.answered).toBe(true);
    await answer(t2, { knowsThem: true, years: 'ONE_TO_THREE', wouldTrust: 'YES' }).expect(200);
    // Answering does not settle the reference: staff still do.
    expect((await db.select().from(references).where(eq(references.caregiverId, c.id))).map((r) => r.verificationStatus)).toEqual(['IN_PROGRESS', 'IN_PROGRESS']);

    await addDocs(c);
    await sweep(c);
    const ready = await file(c);
    expect(ready.recommendation).toBe('READY');
    expect(ready.references.find((r: { name: string }) => r.name === 'Referee0 Silva').answer).toMatchObject({ knowsThem: true, years: 'OVER_3', wouldTrust: 'YES', comment: 'Looked after my father for four years.' });
    expect(staffMail(`Ready to verify: ${c.reg}`)).toHaveLength(1);
    await sweep(c);
    expect(staffMail(`Ready to verify: ${c.reg}`)).toHaveLength(1);
    const [cg] = await db.select({ status: caregivers.status }).from(caregivers).where(eq(caregivers.id, c.id));
    expect(cg.status).toBe('REGISTERED');
    expect(await decisions(c, 'onboarding.set_verification')).toHaveLength(0);
  });

  it('tells staff when documents or a referee do not come', async () => {
    await mode('AUTO');
    const c = await newApplicant();
    await sweep(c);
    expect(await sweep(c, new Date(Date.now() + 4 * DAY))).toMatchObject({ leftToStaff: 0 });
    // Five days: the documents; seven: both referees.
    expect(await sweep(c, new Date(Date.now() + 6 * DAY))).toMatchObject({ leftToStaff: 1 });
    expect(staffMail(`Documents not received: ${c.reg}`)).toHaveLength(1);
    expect(await sweep(c, new Date(Date.now() + 8 * DAY))).toMatchObject({ leftToStaff: 2 });
    expect(await sweep(c, new Date(Date.now() + 9 * DAY))).toMatchObject({ leftToStaff: 0 });
    expect((await api().get(`/automation/cases/CAREGIVER/${c.id}`).set(bearer(staffToken)).expect(200)).body.handoverNote).toMatchObject({ waiting: expect.stringMatching(/^Staff: no answer from Referee[01] and Referee[01] - phone each of them$/) });
  });

  it('flags a referee who does not know the caregiver, and cannot reach one with no email', async () => {
    await mode('AUTO');
    const c = await newApplicant();
    await sweep(c);
    await answer(tokenOf(links(c)[0].cta.url), { knowsThem: false, comment: 'I do not know this person' }).expect(200);
    await addDocs(c);
    await sweep(c);
    expect((await file(c)).recommendation).toBe('CONCERNS');
    expect(staffMail(`Ready to verify: ${c.reg}`)).toHaveLength(0);

    const quiet = await newApplicant({ referees: 1, refereeEmail: false });
    await sweep(quiet);
    const [d] = await decisions(quiet, 'onboarding.follow_up_reference');
    expect(d).toMatchObject({ outcome: 'EXECUTED', executionError: 'This referee has no email and WhatsApp messages are not set up - phone them' });
    expect((await file(quiet)).references[0].sentAt).toBeNull();
    // A failed send is not retried every pass.
    await sweep(quiet);
    expect(await decisions(quiet, 'onboarding.follow_up_reference')).toHaveLength(1);
  });

  it('Assist keeps the file up to date but proposes the messages', async () => {
    await mode('ASSIST');
    const c = await newApplicant();
    await sweep(c);
    expect((await file(c)).recommendation).toBe('NOT_READY');
    expect((await decisions(c, 'onboarding.request_document'))[0]).toMatchObject({ outcome: 'PROPOSED' });
    expect((await decisions(c, 'onboarding.follow_up_reference')).map((d) => d.outcome)).toEqual(['PROPOSED', 'PROPOSED']);
    expect(asked(c)).toHaveLength(0);
    expect(links(c)).toHaveLength(0);
    const [d] = await decisions(c, 'onboarding.request_document');
    await api().post(`/automation/decisions/${d.id}/approve`).set(bearer(staffToken)).expect(200);
    expect(asked(c)).toHaveLength(1);
  });

  it('Shadow only logs, and is scored by what staff do', async () => {
    await mode('SHADOW');
    const c = await newApplicant();
    await sweep(c);
    expect(await file(c)).toBeNull();
    expect(asked(c)).toHaveLength(0);
    expect(links(c)).toHaveLength(0);
    // Staff got the documents in and phoned one referee; then turned the caregiver down.
    await addDocs(c);
    const [r1] = await db.select().from(references).where(eq(references.caregiverId, c.id)).orderBy(references.createdAt);
    await api().patch(`/caregivers/${c.id}/references/${r1.id}/verification`).set(bearer(adminToken)).send({ status: 'VERIFIED' }).expect(200);
    await db.update(caregivers).set({ status: 'REJECTED' }).where(eq(caregivers.id, c.id));
    await agent.scoreShadows([c.id]);
    expect((await decisions(c, 'onboarding.request_document'))[0]).toMatchObject({ staffVerdict: 'AGREED' });
    expect((await decisions(c, 'onboarding.follow_up_reference')).map((d) => d.staffVerdict)).toEqual(['AGREED', 'DIFFERED']);
    expect((await decisions(c, 'onboarding.recommend_verification'))[0]).toMatchObject({ staffVerdict: 'AGREED' });
  });
});
