import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, type CaregiverCareOffer } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, bookingShifts, bookings, careRequests, caregivers, jobs, patients } from '../src/database/schema';
import { BookingAgentService, type DraftBookingProposal } from '../src/bookings/booking-agent.service';
import { BOOKING_REQUEST_JOB } from '../src/bookings/booking-agent-jobs';
import { SEED_PASSWORD } from './seed-password';

/**
 * The booking agent over real HTTP and MySQL: once a caregiver has accepted a
 * job offer it drafts the booking - nothing in Manual, a log entry in Shadow,
 * a proposal in Assist, the draft itself in Auto - and never confirms it.
 *
 * Imported by automation.e2e-spec.ts so it runs in the same worker as the
 * other agents: they share the automation settings. Every sweep here names
 * its own requests.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Booking agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: BookingAgentService;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 5200) % 10_000;
  let n = 0;
  const newPhone = (prefix = '071') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;
  const today = colomboToday();
  const inFiveDays = addDays(today, 5);

  type Cg = { id: string; token: string; reg: string };
  async function newCaregiver(): Promise<Cg> {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Booked Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy', dateOfBirth: '1988-01-20', gender: 'FEMALE',
        civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE' }).where(eq(caregivers.id, row.id));
    return { id: row.id, reg: row.registrationNumber, token: jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' }) };
  }

  /** A request whose caregiver has accepted a job offer at LKR 3,000 a day. */
  async function matched(over: { schedule?: string; urgency?: string; start?: string | null; noRate?: boolean } = {}) {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `booked-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone('077'), consentAccepted: true, ...intake });
    if (reg.status !== 201) throw new Error(`register-patient: ${JSON.stringify(reg.body)}`);
    await db
      .update(patients)
      .set({ careSchedule: (over.schedule ?? 'DAY') as 'DAY', careStart: (over.urgency ?? 'WITHIN_WEEK') as 'WITHIN_WEEK' })
      .where(eq(patients.id, reg.body.patientId));
    const res = await api().post('/care-requests').set(bearer(staffToken)).send({ language: 'si', patientId: reg.body.patientId, careType: 'HOME_SHIFT', message: 'Mother needs help after surgery' }).expect(201);
    const id = res.body.id as string;
    await db.update(careRequests).set({ desiredStartDate: over.start === undefined ? inFiveDays : over.start }).where(eq(careRequests.id, id));
    const caregiver = await newCaregiver();
    await api().post(`/care-requests/${id}/offers`).set(bearer(staffToken)).send({ caregiverId: caregiver.id, ...(over.noRate ? {} : { rateType: 'DAILY', payRate: 3000 }) }).expect(201);
    const [offer] = (await api().get('/me/care-offers').set(bearer(caregiver.token)).expect(200)).body as CaregiverCareOffer[];
    await api().post(`/me/care-offers/${offer.id}/accept`).set(bearer(caregiver.token)).expect(200);
    return { id, reference: res.body.reference as string, caregiver, patientId: reg.body.patientId as string };
  }

  const mode = (m: string) => api().patch('/settings/automation/functions/BOOKING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const sweep = (...requests: { id: string }[]) => agent.sweep(new Date(), requests.map((r) => r.id));
  const decisionsFor = (requestId: string) =>
    db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'REQUEST'), eq(agentDecisions.caseId, requestId), eq(agentDecisions.action, 'booking.create_draft')));
  const bookingsFor = (requestId: string) => db.select().from(bookings).where(eq(bookings.careRequestId, requestId));
  const panel = async (requestId: string) => (await api().get(`/automation/cases/REQUEST/${requestId}`).set(bearer(staffToken)).expect(200)).body;
  const queued = (requestId: string) => db.select().from(jobs).where(and(eq(jobs.type, BOOKING_REQUEST_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.requestId') = ${requestId}`));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(BookingAgentService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree[0].districts[0].id;
    const [city] = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body as { id: number }[];
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId: city.id, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
  });

  afterAll(async () => {
    await mode('MANUAL');
    await app.close();
  });

  it('does nothing while Booking is Manual', async () => {
    await mode('MANUAL');
    const req = await matched();
    expect(await sweep(req)).toMatchObject({ function: 'BOOKING', mode: 'MANUAL', considered: 0, decided: 0 });
    expect(await decisionsFor(req.id)).toHaveLength(0);
    expect(await bookingsFor(req.id)).toHaveLength(0);
    expect(await queued(req.id)).toHaveLength(0);
  });

  it('in Auto, drafts the booking from the accepted offer and leaves confirming to staff', async () => {
    await mode('AUTO');
    const req = await matched();
    // Accepting the offer asked the agent to look straight away.
    expect(await queued(req.id)).toHaveLength(1);

    expect(await sweep(req)).toMatchObject({ mode: 'AUTO', considered: 1, decided: 1, leftToStaff: 0 });
    const [booking] = await bookingsFor(req.id);
    expect(booking).toMatchObject({
      status: 'DRAFT', caregiverId: req.caregiver.id, patientId: req.patientId, scheduleType: 'DAY', daysOfWeek: '1,2,3,4,5',
      shiftStartTime: '08:00', shiftEndTime: '17:00', payRateType: 'DAILY', language: 'si',
    });
    expect(String(booking.startDate).slice(0, 10)).toBe(inFiveDays);
    expect(String(booking.endDate).slice(0, 10)).toBe(addDays(inFiveDays, 13));
    expect(Number(booking.payRateAmount)).toBe(3000);
    expect(booking.notes).toContain('check them with the client before confirming');
    // Ten weekdays in any fourteen days, all still drafts: nobody has been told and nothing is reserved.
    const shifts = await db.select().from(bookingShifts).where(eq(bookingShifts.bookingId, booking.id));
    expect(shifts).toHaveLength(10);
    expect(shifts.every((s) => s.status === 'DRAFT')).toBe(true);

    const [decision] = await decisionsFor(req.id);
    expect(decision).toMatchObject({ outcome: 'EXECUTED', executionError: null, model: null });
    expect(decision.reason).toBe(
      `Draft a booking with ${req.caregiver.reg}: Day shifts, Monday to Friday, 08:00-17:00, from ${inFiveDays} for 14 days (10 shifts), ${booking.rateAmount ? 'at the rates agreed in the offer' : "at the caregiver's agreed pay; the client's rate is still to be set"}`,
    );
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Booked Caregiver', 'surgery']) expect(JSON.stringify(decision)).not.toContain(secret);
    const note = (await panel(req.id)).handoverNote;
    expect(note.done).toBe(`Drafted booking ${booking.reference} with ${req.caregiver.reg}`);
    expect(note.waiting).toBe('Staff to check the times with the client and confirm the booking');
    const detail = (await api().get(`/bookings/${booking.id}`).set(bearer(staffToken)).expect(200)).body;
    expect(detail.createdBy.fullName).toBe('Booking agent (automated)');

    // Looking again makes no second booking.
    expect(await sweep(req)).toMatchObject({ considered: 0, decided: 0 });
    expect(await bookingsFor(req.id)).toHaveLength(1);
  });

  it('does not guess: no hours or no start date goes to staff with the reason', async () => {
    await mode('AUTO');
    const unsure = await matched({ schedule: 'NOT_SURE' });
    const undated = await matched({ start: null, urgency: 'WITHIN_MONTH' });
    expect(await sweep(unsure, undated)).toMatchObject({ considered: 2, decided: 0, leftToStaff: 2 });
    expect(await bookingsFor(unsure.id)).toHaveLength(0);
    expect((await panel(unsure.id)).handoverNote.waiting).toBe('Staff to make the booking: the client was not sure what hours they need');
    expect((await panel(undated.id)).handoverNote.waiting).toBe('Staff to make the booking: the request has no start date');

    // Needed at once with no date: tomorrow. Live-in: every day. No agreed rate: none filled in.
    const urgent = await matched({ start: null, urgency: 'IMMEDIATELY', schedule: 'LIVE_IN_24H', noRate: true });
    expect(await sweep(urgent)).toMatchObject({ decided: 1 });
    const [booking] = await bookingsFor(urgent.id);
    expect(booking).toMatchObject({ scheduleType: 'LIVE_IN', daysOfWeek: '1,2,3,4,5,6,7', payRateType: null, rateType: null });
    expect(String(booking.startDate).slice(0, 10)).toBe(addDays(today, 1));
  });

  it('leaves alone a request staff have already booked, taken over, or given to someone else', async () => {
    await mode('AUTO');
    const booked = await matched();
    await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({ careRequestId: booked.id, scheduleType: 'NIGHT', daysOfWeek: [1, 2, 3], shiftStartTime: '20:00', shiftEndTime: '06:00', startDate: inFiveDays, endDate: addDays(inFiveDays, 6) })
      .expect(201);
    expect(await sweep(booked)).toMatchObject({ considered: 0, decided: 0 });
    expect(await bookingsFor(booked.id)).toHaveLength(1);

    const taken = await matched();
    await api().post(`/automation/cases/REQUEST/${taken.id}/take-over`).set(bearer(staffToken)).send({ reason: 'The family wants to agree the hours first' }).expect(200);
    expect(await sweep(taken)).toMatchObject({ considered: 1, decided: 0 });
    expect(await bookingsFor(taken.id)).toHaveLength(0);

    const swapped = await matched();
    const other = await newCaregiver();
    await db.update(careRequests).set({ caregiverId: other.id }).where(eq(careRequests.id, swapped.id));
    expect(await sweep(swapped)).toMatchObject({ considered: 0 });
    expect(await bookingsFor(swapped.id)).toHaveLength(0);
  });

  it('in Assist, proposes the draft; approving creates it under the staff member, declining is final', async () => {
    await mode('ASSIST');
    const yes = await matched();
    const no = await matched();
    expect(await sweep(yes, no)).toMatchObject({ mode: 'ASSIST', decided: 2 });
    expect(await bookingsFor(yes.id)).toHaveLength(0);
    expect((await panel(yes.id)).handoverNote.waiting).toBe('Staff to approve or decline the draft booking');
    const [proposal] = await decisionsFor(yes.id);
    expect(proposal.outcome).toBe('PROPOSED');
    expect((proposal.proposal as DraftBookingProposal).draft).toMatchObject({ scheduleType: 'DAY', startDate: inFiveDays, shifts: 10, payRateAmount: '3000.00' });

    await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken)).expect(200);
    const [booking] = await bookingsFor(yes.id);
    expect(booking.status).toBe('DRAFT');
    expect((await panel(yes.id)).handoverNote.done).toBe(`Drafted booking ${booking.reference} with ${yes.caregiver.reg}`);

    const [declined] = await decisionsFor(no.id);
    await api().post(`/automation/decisions/${declined.id}/decline`).set(bearer(staffToken)).send({ note: 'The family will call back about the hours' }).expect(200);
    await sweep(yes, no);
    expect(await decisionsFor(no.id)).toHaveLength(1);
    expect(await bookingsFor(no.id)).toHaveLength(0);
    expect(await bookingsFor(yes.id)).toHaveLength(1);
  });

  it('refuses an approval that has gone stale', async () => {
    await mode('ASSIST');
    const req = await matched();
    await sweep(req);
    const [proposal] = await decisionsFor(req.id);
    // Staff make the booking themselves before anyone approves the proposal.
    await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({ careRequestId: req.id, scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: inFiveDays, endDate: addDays(inFiveDays, 13) })
      .expect(201);
    const res = await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await bookingsFor(req.id)).toHaveLength(1);
  });

  it('in Shadow, only logs, then scores itself against the booking staff make', async () => {
    await mode('SHADOW');
    const same = await matched();
    const different = await matched();
    expect(await sweep(same, different)).toMatchObject({ mode: 'SHADOW', decided: 2, scored: 0 });
    expect(await bookingsFor(same.id)).toHaveLength(0);
    expect((await decisionsFor(same.id))[0].outcome).toBe('SHADOW');

    const book = (id: string, body: Record<string, unknown>) => api().post('/bookings').set(bearer(staffToken)).send({ careRequestId: id, startDate: inFiveDays, endDate: addDays(inFiveDays, 27), ...body }).expect(201);
    // Same kind of schedule and start date - a longer run and different hours still count as agreeing.
    await book(same.id, { scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5, 6], shiftStartTime: '07:00', shiftEndTime: '16:00' });
    await book(different.id, { scheduleType: 'NIGHT', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], shiftStartTime: '20:00', shiftEndTime: '08:00' });
    expect(await sweep(same, different)).toMatchObject({ scored: 2, decided: 0 });
    expect((await decisionsFor(same.id))[0].staffVerdict).toBe('AGREED');
    const [missed] = await decisionsFor(different.id);
    expect(missed.staffVerdict).toBe('DIFFERED');
    expect(missed.staffNote).toContain(`as NIGHT from ${inFiveDays}; the agent drafted DAY from ${inFiveDays}`);
  });
});
