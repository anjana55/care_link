import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday, toColombo, type StaffCheckIn } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, bookingShifts, caregivers, jobs, patients } from '../src/database/schema';
import { LiveCareAgentService, type VisitProposal } from '../src/bookings/live-care-agent.service';
import { LIVE_CARE_SHIFT_JOB } from '../src/bookings/live-care-jobs';
import { CoverAgentService } from '../src/cover/cover-agent.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { EmailService } from '../src/email/email.service';
import { WhatsappProviderService } from '../src/whatsapp/whatsapp-provider.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The live-care agent over real HTTP and MySQL: it chases a caregiver who has
 * not checked in, tells staff when a visit needs a person, and marks a shift
 * done once the caregiver has been and gone - nothing in Manual or with
 * check-in off, a log entry in Shadow, proposals in Assist.
 *
 * Imported by automation.e2e-spec.ts (as the check-in cases are) so it runs
 * in the same worker: these suites share the automation dials and the
 * check-in switch. Every sweep here names its own shifts.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Live-care agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: LiveCareAgentService;
  let intake: Record<string, unknown>;
  let notify: jest.SpyInstance;
  let sendUpdate: jest.SpyInstance;
  let canSend: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;
  let coverPart: jest.SpyInstance;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 8600) % 10_000;
  let n = 0;
  const newPhone = (prefix = '071') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;
  const minutes = (m: number) => new Date(Date.now() + m * 60_000);
  let weekOffset = 0;
  const freshMonday = () => {
    let d = addDays(colomboToday(), 300 + 21 * weekOffset++);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  };

  /** A confirmed booking with one four-hour shift that starts `startsIn` minutes from now, with its own client and caregiver. */
  async function visit(startsIn: number, over: { phoneOnly?: boolean } = {}) {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Watched Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy', dateOfBirth: '1988-01-20', gender: 'FEMALE',
        civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [cg] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE', ...(over.phoneOnly ? { preferredContactMethod: 'PHONE_CALL' as const } : {}) }).where(eq(caregivers.id, cg.id));
    const cgToken = jwt.sign({ sub: cg.userId, role: 'CAREGIVER', caregiverId: cg.id }, { secret: accessSecret, expiresIn: '10m' });
    const client = await api()
      .post('/auth/register-patient')
      .send({ email: `watched-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone('077'), consentAccepted: true, ...intake })
      .expect(201);
    const [patient] = await db.select().from(patients).where(eq(patients.id, client.body.patientId));
    const monday = freshMonday();
    const draft = await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({ patientId: patient.id, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: monday, endDate: monday, rateType: 'DAILY', rateAmount: '3500' })
      .expect(201);
    const booking = (await api().post(`/bookings/${draft.body.id}/confirm`).set(bearer(staffToken)).expect(200)).body;
    const shiftId = booking.shifts[0].id as string;
    const startsAt = minutes(startsIn);
    await db.update(bookingShifts).set({ startsAt, endsAt: minutes(startsIn + 240) }).where(eq(bookingShifts.id, shiftId));
    const [stored] = await db.select().from(bookingShifts).where(eq(bookingShifts.id, shiftId));
    return {
      id: shiftId, bookingId: booking.id as string, reference: booking.reference as string, reg: cg.registrationNumber, cgUserId: cg.userId!, cgToken, cgPhone: phone,
      patientUserId: patient.userId, time: toColombo(stored.startsAt).time,
    };
  }
  type Visit = Awaited<ReturnType<typeof visit>>;

  const mode = (m: string) => api().patch('/settings/automation/functions/LIVE_CARE').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const checkInSetting = (enabled: boolean) => api().patch('/settings/check-in').set(bearer(adminToken)).send({ enabled, earlyMinutes: 60, lateAfterMinutes: 15 }).expect(200);
  const sweep = (at: Date, ...visits: { id: string }[]) => agent.sweep(at, visits.map((v) => v.id));
  const decisionsFor = async (v: Visit, action?: string) =>
    (await db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'BOOKING'), eq(agentDecisions.caseId, v.bookingId))).orderBy(agentDecisions.createdAt)).filter(
      (d) => d.function === 'LIVE_CARE' && (!action || d.action === action),
    );
  const shiftNow = async (v: Visit) =>
    ((await api().get(`/bookings/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body.shifts as { id: string; status: string; updatedBy: { fullName: string } | null; checkIn: StaffCheckIn }[]).find((s) => s.id === v.id)!;
  const note = async (v: Visit) => (await api().get(`/automation/cases/BOOKING/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body.handoverNote;
  const staffRecord = (v: Visit, what: 'check-in' | 'check-out', at: Date) => api().post(`/visits/${v.id}/${what}`).set(bearer(staffToken)).send({ at: at.toISOString() }).expect(200);
  const toldCaregiver = (v: Visit) => notify.mock.calls.filter((c) => c[3] === `check-in chase ${v.id}`);
  /** Emails to staff about this visit: [to, { subject, blocks, cta }, label]. */
  const toldStaff = (v: Visit) => sendEmail.mock.calls.filter((c) => typeof c[2] === 'string' && c[2].startsWith(`visit ${v.id} `));
  /** WhatsApp messages from the agent (confirming a booking sends its own). */
  const chaseMessages = () => sendUpdate.mock.calls.filter((c) => String(c[3]).includes('Please check in for your shift'));
  const alertTitle = (v: Visit) => (toldStaff(v)[0][1] as { subject: string }).subject;
  const queued = (v: Visit) => db.select().from(jobs).where(and(eq(jobs.type, LIVE_CARE_SHIFT_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.shiftId') = ${v.id}`));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(LiveCareAgentService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
    await checkInSetting(true);
  });

  beforeEach(() => {
    notify = jest.spyOn(app.get(NotificationsService), 'notify');
    canSend = jest.spyOn(app.get(WhatsappProviderService), 'canSendUpdates').mockReturnValue(true);
    sendUpdate = jest.spyOn(app.get(WhatsappProviderService), 'sendUpdate').mockResolvedValue({ provider: 'CONSOLE' });
    sendEmail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue();
    // Looking for cover is the other part of this agent, with cases of its own (cover.cases.ts); here it sits out, so these counts are the visits' alone.
    coverPart = jest.spyOn(app.get(CoverAgentService), 'sweep').mockResolvedValue({ considered: 0, decided: 0, scored: 0, leftToStaff: 0 });
  });
  afterEach(() => {
    coverPart.mockRestore();
    notify.mockRestore();
    canSend.mockRestore();
    sendUpdate.mockRestore();
    sendEmail.mockRestore();
  });

  afterAll(async () => {
    await mode('MANUAL');
    await checkInSetting(false);
    await app.close();
  });

  it('does nothing while Live care is Manual, or while check-in is switched off', async () => {
    await mode('MANUAL');
    const late = await visit(-20);
    expect(await sweep(new Date(), late)).toMatchObject({ function: 'LIVE_CARE', mode: 'MANUAL', considered: 0, decided: 0 });
    // A check-out queues nothing for an agent that is switched off.
    await staffRecord(late, 'check-in', minutes(-18));
    await staffRecord(late, 'check-out', minutes(-1));
    expect(await queued(late)).toHaveLength(0);

    await mode('AUTO');
    await checkInSetting(false);
    const unseen = await visit(-20);
    expect(await sweep(new Date(), unseen)).toMatchObject({ mode: 'AUTO', considered: 0, decided: 0 });
    await checkInSetting(true);
    expect(await decisionsFor(unseen)).toHaveLength(0);
    expect(toldCaregiver(unseen)).toHaveLength(0);
  });

  it('in Auto, asks a late caregiver to check in - once - then tells staff if they still have not', async () => {
    await mode('AUTO');
    const v = await visit(-20);
    const early = await visit(-5); // started, but not late yet

    expect(await sweep(new Date(), v, early)).toMatchObject({ mode: 'AUTO', considered: 1, decided: 1, leftToStaff: 0 });
    const [chase] = await decisionsFor(v);
    expect(chase).toMatchObject({ action: 'live_care.chase_late_caregiver', outcome: 'EXECUTED', executionError: null, model: null });
    expect(chase.reason).toMatch(new RegExp(`^Ask ${v.reg} to check in: the ${v.time} visit started (19|20) min ago with nobody checked in$`));
    expect(await decisionsFor(early)).toHaveLength(0);

    // The caregiver's bell and push, opening Shifts; and a WhatsApp message. Nothing in either says who the client is.
    const [bell] = toldCaregiver(v);
    expect(bell[0]).toEqual([v.cgUserId]);
    expect(bell[2]).toBe('/shifts');
    const text = (bell[1] as (l: 'en' | 'si') => { title: string; body: string })('en');
    expect(text.title).toBe('Please check in for your shift');
    expect(text.body).toBe(`Your shift started at ${v.time} and you have not checked in. If you are with the client, check in now with their code. If you cannot be there, call the office.`);
    expect((bell[1] as (l: 'si') => { title: string })('si').title).not.toBe(text.title);
    expect(chaseMessages()).toHaveLength(1);
    const message = chaseMessages()[0][3] as string;
    expect(chaseMessages()[0][1]).toBe(`+94${v.cgPhone.slice(1)}`);
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Fernando', 'bathing', v.reference]) expect(message + JSON.stringify(text)).not.toContain(secret);
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Fernando', 'bathing', 'Watched Caregiver', v.cgPhone]) expect(JSON.stringify(chase)).not.toContain(secret);
    expect(await note(v)).toMatchObject({ done: `Asked ${v.reg} to check in for the ${v.time} visit (bell and whatsapp)`, waiting: 'The caregiver to check in' });
    // The client is told nothing by the agent, now or later.
    expect(toldCaregiver(v).some((c) => (c[0] as string[]).includes(v.patientUserId!))).toBe(false);

    // Looking again, and again ten minutes on: nothing more.
    expect(await sweep(new Date(), v)).toMatchObject({ considered: 0, decided: 0 });
    expect(await sweep(minutes(10), v)).toMatchObject({ considered: 0, decided: 0 });
    expect(toldCaregiver(v)).toHaveLength(1);

    // A quarter of an hour after the chase: staff are told, once, with what to do.
    expect(await sweep(minutes(16), v)).toMatchObject({ considered: 1, decided: 1, leftToStaff: 1 });
    const [, flag] = await decisionsFor(v);
    expect(flag).toMatchObject({ action: 'live_care.flag_visit', outcome: 'EXECUTED', executionError: null });
    expect(flag.reason).toMatch(new RegExp(`^${v.reg} was due at ${v.time}, was asked to check in, and still has not \\(3[5-7] min late\\)$`));
    expect((flag.proposal as VisitProposal).kind).toBe('STILL_LATE');
    const [alert] = toldStaff(v);
    expect(alert[0]).toContain('staff@care-platform.local');
    const mail = alert[1] as { subject: string; blocks: { paragraphs: string[] }[]; cta: { url: string } };
    expect(mail.subject).toBe(`Visit not checked in: ${v.reference}`);
    expect(mail.blocks[0].paragraphs.slice(0, 2)).toEqual([`${flag.reason}.`, 'Staff to phone the caregiver, then the client.']);
    expect(mail.cta.url).toMatch(/\/bookings\/today$/);
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Watched Caregiver', v.cgPhone]) expect(JSON.stringify(mail)).not.toContain(secret);
    expect(await note(v)).toMatchObject({ done: flag.reason, waiting: 'Staff to phone the caregiver, then the client' });
    expect(await sweep(minutes(40), v)).toMatchObject({ considered: 0, decided: 0 });
    expect(toldStaff(v)).toHaveLength(1);
    // The agent never marks a shift missed.
    expect((await shiftNow(v)).status).toBe('SCHEDULED');
  });

  it('stops there when the caregiver checks in after the chase, and does not message a caregiver who asked to be phoned', async () => {
    await mode('AUTO');
    const v = await visit(-20, { phoneOnly: true });
    await sweep(new Date(), v);
    expect(toldCaregiver(v)).toHaveLength(1);
    expect(chaseMessages()).toHaveLength(0);
    expect((await note(v)).done).toBe(`Asked ${v.reg} to check in for the ${v.time} visit (bell)`);
    const code = (await shiftNow(v)).checkIn.arrivalCode;
    await api().post(`/me/shifts/${v.id}/check-in`).set(bearer(v.cgToken)).send({ code }).expect(200);
    expect(await sweep(minutes(16), v)).toMatchObject({ considered: 0, decided: 0, leftToStaff: 0 });
    expect(await decisionsFor(v)).toHaveLength(1);
  });

  it('marks the shift done once the caregiver has been and gone, and tells staff when they left early', async () => {
    await mode('AUTO');
    // Four hours, nearly over: in two minutes after the start, out now.
    const v = await visit(-235);
    await staffRecord(v, 'check-in', minutes(-233));
    expect(await sweep(new Date(), v)).toMatchObject({ considered: 0 }); // still there
    await api().post(`/me/shifts/${v.id}/check-out`).set(bearer(v.cgToken)).send({}).expect(200);
    // Checking out asks the agent to look straight away.
    expect(await queued(v)).toHaveLength(1);
    expect(await sweep(new Date(), v)).toMatchObject({ considered: 1, decided: 1, leftToStaff: 0 });
    const [done] = await decisionsFor(v);
    expect(done).toMatchObject({ action: 'live_care.complete_shift', outcome: 'EXECUTED', executionError: null });
    expect(done.reason).toMatch(new RegExp(`^Mark the ${v.time} shift done: ${v.reg} checked in and out, and was there 23[2-4] of 240 minutes$`));
    const shift = await shiftNow(v);
    expect(shift.status).toBe('COMPLETED');
    expect(shift.updatedBy?.fullName).toBe('Live care agent (automated)');
    expect(shift.checkIn.state).toBe('OUT');
    expect((await note(v)).done).toBe(`Marked the ${v.time} shift done after ${v.reg} checked out`);
    expect(await sweep(new Date(), v)).toMatchObject({ considered: 0, decided: 0 });

    // Out after an hour of four: not done - a person decides.
    const short = await visit(-200);
    await staffRecord(short, 'check-in', minutes(-200));
    await staffRecord(short, 'check-out', minutes(-140));
    expect(await sweep(new Date(), short)).toMatchObject({ considered: 1, decided: 1, leftToStaff: 1 });
    const [flag] = await decisionsFor(short);
    expect(flag).toMatchObject({ action: 'live_care.flag_visit', outcome: 'EXECUTED' });
    expect(flag.reason).toMatch(new RegExp(`^${short.reg} checked out after (59|60) min of a 4 h visit$`));
    expect((await shiftNow(short)).status).toBe('SCHEDULED');
    expect(alertTitle(short)).toBe(`Visit cut short: ${short.reference}`);
    expect((await note(short)).waiting).toBe('Staff to check with the client, then mark the shift done or change its times');
    expect(await sweep(new Date(), short)).toMatchObject({ considered: 0 });
  });

  it('tells staff about a visit that ended with no check-in, but leaves old history and taken-over bookings alone', async () => {
    await mode('AUTO');
    const ended = await visit(-300); // ended an hour ago
    const old = await visit(-(13 * 60 + 240)); // ended thirteen hours ago
    const taken = await visit(-20);
    await api().post(`/automation/cases/BOOKING/${taken.bookingId}/take-over`).set(bearer(staffToken)).send({ reason: 'I am on the phone with the family' }).expect(200);

    expect(await sweep(new Date(), ended, old, taken)).toMatchObject({ considered: 2, decided: 1, leftToStaff: 1 });
    const [flag] = await decisionsFor(ended);
    expect(flag.reason).toBe(`The ${ended.time} visit ended with no check-in from ${ended.reg}`);
    expect((await note(ended)).waiting).toBe('Staff to find out whether the visit happened, and mark the shift done or missed');
    expect(await decisionsFor(old)).toHaveLength(0);
    expect(await decisionsFor(taken)).toHaveLength(0);
    expect(toldCaregiver(taken)).toHaveLength(0);
    // No caregiver is chased about a visit that is already over.
    expect(toldCaregiver(ended)).toHaveLength(0);
  });

  it('in Assist, proposes the chase and "mark done"; a stale approval is refused', async () => {
    await mode('ASSIST');
    const v = await visit(-20);
    expect(await sweep(new Date(), v)).toMatchObject({ mode: 'ASSIST', considered: 1, decided: 1 });
    const [chase] = await decisionsFor(v);
    expect(chase.outcome).toBe('PROPOSED');
    expect(toldCaregiver(v)).toHaveLength(0);
    await api().post(`/automation/decisions/${chase.id}/approve`).set(bearer(staffToken)).expect(200);
    expect(toldCaregiver(v)).toHaveLength(1);
    // Telling staff needs nobody's approval.
    expect(await sweep(minutes(16), v)).toMatchObject({ decided: 1, leftToStaff: 1 });
    expect((await decisionsFor(v, 'live_care.flag_visit'))[0].outcome).toBe('EXECUTED');

    // The caregiver checks in before anyone approves the chase: approving it now is refused.
    const w = await visit(-20);
    await sweep(new Date(), w);
    const [stale] = await decisionsFor(w);
    await staffRecord(w, 'check-in', minutes(-1));
    const refused = await api().post(`/automation/decisions/${stale.id}/approve`).set(bearer(staffToken));
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(toldCaregiver(w)).toHaveLength(0);

    // "Mark done" is proposed, and approving it does it under the staff member.
    const x = await visit(-235);
    await staffRecord(x, 'check-in', minutes(-233));
    await staffRecord(x, 'check-out', minutes(-1));
    await sweep(new Date(), x);
    const [done] = await decisionsFor(x);
    expect(done).toMatchObject({ action: 'live_care.complete_shift', outcome: 'PROPOSED' });
    expect((await shiftNow(x)).status).toBe('SCHEDULED');
    await api().post(`/automation/decisions/${done.id}/approve`).set(bearer(staffToken)).expect(200);
    const shift = await shiftNow(x);
    expect(shift.status).toBe('COMPLETED');
    expect(shift.updatedBy?.fullName).not.toMatch(/agent/i);
    // Proposed once only.
    await sweep(new Date(), v, x);
    expect(await decisionsFor(x)).toHaveLength(1);
  });

  it('in Shadow, only logs, and scores "mark done" against what staff did with the shift', async () => {
    await mode('SHADOW');
    const late = await visit(-20);
    const done = await visit(-235);
    const missed = await visit(-235);
    for (const v of [done, missed]) {
      await staffRecord(v, 'check-in', minutes(-233));
      await staffRecord(v, 'check-out', minutes(-1));
    }
    expect(await sweep(new Date(), late, done, missed)).toMatchObject({ mode: 'SHADOW', considered: 3, decided: 3, scored: 0, leftToStaff: 0 });
    expect((await decisionsFor(late))[0]).toMatchObject({ action: 'live_care.chase_late_caregiver', outcome: 'SHADOW' });
    expect(toldCaregiver(late)).toHaveLength(0);
    expect(chaseMessages()).toHaveLength(0);
    expect((await shiftNow(done)).status).toBe('SCHEDULED');
    // The flag a quarter of an hour on is logged too, and tells nobody.
    expect(await sweep(minutes(16), late)).toMatchObject({ decided: 1, leftToStaff: 0 });
    expect(toldStaff(late)).toHaveLength(0);

    const set = (v: Visit, status: string) => api().patch(`/bookings/${v.bookingId}/shifts/${v.id}`).set(bearer(staffToken)).send({ status }).expect(200);
    await set(done, 'COMPLETED');
    await set(missed, 'MISSED');
    expect(await sweep(new Date(), late, done, missed)).toMatchObject({ scored: 2, decided: 0 });
    expect((await decisionsFor(done))[0]).toMatchObject({ staffVerdict: 'AGREED', staffNote: 'Scored automatically: staff marked the shift done' });
    expect((await decisionsFor(missed))[0]).toMatchObject({ staffVerdict: 'DIFFERED', staffNote: 'Scored automatically: staff marked the shift missed' });
  });
});
