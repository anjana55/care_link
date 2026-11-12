import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, type CaregiverCareOffer, type ClientBookingProposal } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, bookingEvents, bookingShifts, bookings, careRequests, caregivers, jobs, patients, requestOffers } from '../src/database/schema';
import { BookingAgentService, type DraftBookingProposal } from '../src/bookings/booking-agent.service';
import { AutomationService } from '../src/automation/automation.service';
import { BOOKING_CONFIRM_JOB, BOOKING_REQUEST_JOB } from '../src/bookings/booking-agent-jobs';
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
  async function matched(over: { schedule?: string; urgency?: string; start?: string | null; noRate?: boolean; noClientRate?: boolean } = {}) {
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
    // What the client pays depends on the fee set for this kind of care, which another suite changes: fix it here.
    await db.update(requestOffers).set({ clientRate: over.noRate || over.noClientRate ? null : 3450 }).where(eq(requestOffers.id, offer.id));
    await api().post(`/me/care-offers/${offer.id}/accept`).set(bearer(caregiver.token)).expect(200);
    const [patient] = await db.select({ userId: patients.userId }).from(patients).where(eq(patients.id, reg.body.patientId));
    const clientToken = jwt.sign({ sub: patient.userId, role: 'PATIENT_GUARDIAN', patientId: reg.body.patientId }, { secret: accessSecret, expiresIn: '10m' });
    return { id, reference: res.body.reference as string, caregiver, patientId: reg.body.patientId as string, clientToken };
  }

  const mode = (m: string) => api().patch('/settings/automation/functions/BOOKING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const sweep = (...requests: { id: string }[]) => agent.sweep(new Date(), requests.map((r) => r.id));
  const decisionsFor = (requestId: string) =>
    db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'REQUEST'), eq(agentDecisions.caseId, requestId), eq(agentDecisions.action, 'booking.create_draft')));
  const bookingsFor = (requestId: string) => db.select().from(bookings).where(eq(bookings.careRequestId, requestId));
  const panel = async (requestId: string) => (await api().get(`/automation/cases/REQUEST/${requestId}`).set(bearer(staffToken)).expect(200)).body;
  const proposalsOf = async (token: string) => (await api().get('/me/booking-proposals').set(bearer(token)).expect(200)).body as ClientBookingProposal[];
  const bookingRow = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
  const confirmDecisions = (bookingId: string) =>
    db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'BOOKING'), eq(agentDecisions.caseId, bookingId), eq(agentDecisions.action, 'booking.confirm')));
  const bookingPanel = async (id: string) => (await api().get(`/automation/cases/BOOKING/${id}`).set(bearer(staffToken)).expect(200)).body;
  const pattern = (over: Record<string, unknown> = {}) => ({ scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: inFiveDays, endDate: addDays(inFiveDays, 13), ...over });
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
      `Draft a booking with ${req.caregiver.reg}: Day shifts, Monday to Friday, 08:00-17:00, from ${inFiveDays} for 14 days (10 shifts), at the rates agreed in the offer. Then ask the client to check it`,
    );
    for (const secret of ['Nimal', 'Perera', 'Sunil', 'Booked Caregiver', 'surgery']) expect(JSON.stringify(decision)).not.toContain(secret);
    // With only Booking switched on, the request page still shows an agent at work (and so offers Take over).
    expect(await panel(req.id)).toMatchObject({ agentActive: true, mode: 'AUTO' });
    const note = (await panel(req.id)).handoverNote;
    // The client is asked to check it, in their account; it is still only a draft.
    expect(note.done).toBe(`Drafted booking ${booking.reference} with ${req.caregiver.reg} and asked the client to check it`);
    expect(note.waiting).toBe('The client to accept it or ask for changes');
    expect(booking.clientReviewStatus).toBe('ASKED');
    expect(Number(booking.rateAmount)).toBe(3450);
    expect(await proposalsOf(req.clientToken)).toMatchObject([{ id: booking.id, status: 'ASKED', shiftCount: 10, rateAmount: '3450.00' }]);
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
    // No price to agree to, so the client is not asked: that stays with staff.
    expect(booking.clientReviewStatus).toBeNull();
    expect((await panel(urgent.id)).handoverNote.waiting).toBe("Staff to check the times with the client and confirm the booking (the client's rate is not set yet)");
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
    expect((await panel(yes.id)).handoverNote.done).toBe(`Drafted booking ${booking.reference} with ${yes.caregiver.reg} and asked the client to check it`);

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

  describe('the client checks the draft', () => {
    const staffDraft = async (req: { id: string }) =>
      (await api().post('/bookings').set(bearer(staffToken)).send({ careRequestId: req.id, ...pattern(), rateType: 'DAILY', rateAmount: '3450.00', payRateType: 'DAILY', payRateAmount: '3000.00', notes: 'Client prefers Sinhala' }).expect(201)).body as { id: string; reference: string };

    it('by hand, with every agent off: staff ask, the client sees only their own draft and accepts, staff confirm', async () => {
      await mode('MANUAL');
      const req = await matched();
      const other = await matched();
      const draft = await staffDraft(req);
      expect(await proposalsOf(req.clientToken)).toEqual([]);

      const asked = (await api().post(`/bookings/${draft.id}/ask-client`).set(bearer(staffToken)).expect(200)).body;
      expect(asked).toMatchObject({ status: 'DRAFT', clientReviewStatus: 'ASKED' });
      expect((await api().post(`/bookings/${draft.id}/ask-client`).set(bearer(staffToken)).expect(400)).body.message).toBe('The client has already been asked and has not answered yet');

      const [mine] = await proposalsOf(req.clientToken);
      expect(mine).toMatchObject({
        id: draft.id, reference: draft.reference, status: 'ASKED', scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00',
        startDate: inFiveDays, endDate: addDays(inFiveDays, 13), shiftCount: 10, rateType: 'DAILY', rateAmount: '3450.00', answeredAt: null, note: null,
      });
      // What the caregiver is paid and the office's notes are not the client's to see.
      expect(Object.keys(mine).sort()).toEqual(['answeredAt', 'askedAt', 'caregiver', 'daysOfWeek', 'endDate', 'id', 'note', 'rateAmount', 'rateType', 'reference', 'scheduleType', 'shiftCount', 'shiftEndTime', 'shiftStartTime', 'startDate', 'status']);
      expect(JSON.stringify(mine)).not.toMatch(/3000|Sinhala/);
      // Someone else's draft: not listed, and answering it is refused the same way as one that is not waiting.
      expect(await proposalsOf(other.clientToken)).toEqual([]);
      await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(other.clientToken)).expect(409);
      await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(req.caregiver.token)).expect(403);
      // Drafts still do not show among the client's bookings.
      expect((await api().get('/me/bookings').set(bearer(req.clientToken)).expect(200)).body).toEqual([]);

      const after = (await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(req.clientToken)).expect(200)).body as ClientBookingProposal[];
      expect(after[0]).toMatchObject({ status: 'ACCEPTED' });
      expect(after[0].answeredAt).toBeTruthy();
      await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(req.clientToken)).expect(409);
      // Accepting books nothing, and with Booking at Manual nothing is queued for the agent.
      expect((await bookingRow(draft.id)).status).toBe('DRAFT');
      expect(await db.select().from(jobs).where(and(eq(jobs.type, BOOKING_CONFIRM_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.bookingId') = ${draft.id}`))).toHaveLength(0);
      const notes = (await db.select().from(bookingEvents).where(eq(bookingEvents.bookingId, draft.id))).map((e) => e.note);
      expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('Asked the client to check the booking'), 'The client accepted the booking as drafted']));

      await api().post(`/bookings/${draft.id}/confirm`).set(bearer(staffToken)).expect(200);
      expect(await proposalsOf(req.clientToken)).toEqual([]);
      expect((await api().get('/me/bookings').set(bearer(req.clientToken)).expect(200)).body).toHaveLength(1);
    });

    it('lets the client ask for changes; changing the draft clears their answer and they are asked again', async () => {
      await mode('MANUAL');
      const req = await matched();
      const draft = await staffDraft(req);
      await api().post(`/bookings/${draft.id}/ask-client`).set(bearer(staffToken)).expect(200);
      await api().post(`/me/booking-proposals/${draft.id}/request-changes`).set(bearer(req.clientToken)).send({ note: '  ' }).expect(400);
      const [changed] = (await api().post(`/me/booking-proposals/${draft.id}/request-changes`).set(bearer(req.clientToken)).send({ note: 'Could the carer come at 9 instead of 8?' }).expect(200)).body as ClientBookingProposal[];
      expect(changed).toMatchObject({ status: 'CHANGES_REQUESTED', note: 'Could the carer come at 9 instead of 8?' });
      // Not confirmable by the client afterwards, and staff see what was asked.
      await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(req.clientToken)).expect(409);
      expect((await api().get(`/bookings/${draft.id}`).set(bearer(staffToken)).expect(200)).body).toMatchObject({ clientReviewStatus: 'CHANGES_REQUESTED', clientReviewNote: 'Could the carer come at 9 instead of 8?' });

      // A note alone does not touch the answer; new times do.
      await api().patch(`/bookings/${draft.id}`).set(bearer(staffToken)).send({ notes: 'Called the daughter' }).expect(200);
      expect((await bookingRow(draft.id)).clientReviewStatus).toBe('CHANGES_REQUESTED');
      const reshaped = (await api().patch(`/bookings/${draft.id}`).set(bearer(staffToken)).send({ pattern: pattern({ shiftStartTime: '09:00', shiftEndTime: '18:00' }) }).expect(200)).body;
      expect(reshaped).toMatchObject({ clientReviewStatus: null, clientReviewNote: null, clientAnsweredAt: null });
      expect(await proposalsOf(req.clientToken)).toEqual([]);

      await api().post(`/bookings/${draft.id}/ask-client`).set(bearer(staffToken)).expect(200);
      expect(await proposalsOf(req.clientToken)).toMatchObject([{ status: 'ASKED', shiftStartTime: '09:00', note: null }]);
      await api().post(`/me/booking-proposals/${draft.id}/accept`).set(bearer(req.clientToken)).expect(200);
      // An accepted draft whose price then changes is no longer accepted.
      await api().patch(`/bookings/${draft.id}`).set(bearer(staffToken)).send({ rateType: 'DAILY', rateAmount: '3600.00' }).expect(200);
      expect((await bookingRow(draft.id)).clientReviewStatus).toBeNull();
    });

    it('will not ask without a price, or once it is no longer a draft', async () => {
      await mode('MANUAL');
      const req = await matched();
      const noPrice = (await api().post('/bookings').set(bearer(staffToken)).send({ careRequestId: req.id, ...pattern() }).expect(201)).body;
      expect((await api().post(`/bookings/${noPrice.id}/ask-client`).set(bearer(staffToken)).expect(400)).body.message).toBe("Set the client's rate first - they are asked to agree to the price");
      await api().patch(`/bookings/${noPrice.id}`).set(bearer(staffToken)).send({ rateType: 'DAILY', rateAmount: '3450.00' }).expect(200);
      await api().post(`/bookings/${noPrice.id}/confirm`).set(bearer(staffToken)).expect(200);
      expect((await api().post(`/bookings/${noPrice.id}/ask-client`).set(bearer(staffToken)).expect(400)).body.message).toBe('Only a draft booking can be sent to the client to check');
      await api().post(`/bookings/${noPrice.id}/ask-client`).set(bearer(req.caregiver.token)).expect(403);
    });

    it('with the agent on: an accepted draft is proposed for confirming until that is earned, then confirmed', async () => {
      await mode('AUTO');
      const policy = (body: object) => api().patch('/settings/automation/actions/booking.confirm').set(bearer(adminToken)).send(body);
      await policy({ autoAllowed: false });
      const first = await matched();
      await sweep(first);
      const [booking] = await bookingsFor(first.id);
      expect(booking.clientReviewStatus).toBe('ASKED');
      // Nothing to do while the client has not answered.
      expect(await agent.answers(new Date(), [booking.id])).toMatchObject({ considered: 0, decided: 0 });

      await api().post(`/me/booking-proposals/${booking.id}/accept`).set(bearer(first.clientToken)).expect(200);
      expect(await db.select().from(jobs).where(and(eq(jobs.type, BOOKING_CONFIRM_JOB), sql`JSON_EXTRACT(${jobs.payload}, '$.bookingId') = ${booking.id}`))).toHaveLength(1);
      expect(await agent.answers(new Date(), [booking.id])).toMatchObject({ considered: 1, decided: 1, leftToStaff: 0 });
      const [asked] = await confirmDecisions(booking.id);
      expect(asked).toMatchObject({ outcome: 'PROPOSED', mode: 'AUTO', reason: `Confirm ${booking.reference}: the client accepted the times and the price as drafted` });
      expect((await bookingRow(booking.id)).status).toBe('DRAFT');
      expect((await bookingPanel(booking.id)).handoverNote.waiting).toBe('Staff to approve confirming it');
      // Looking again proposes nothing new.
      expect(await agent.answers(new Date(), [booking.id])).toMatchObject({ decided: 0 });

      await api().post(`/automation/decisions/${asked.id}/approve`).set(bearer(staffToken)).expect(200);
      expect(await bookingRow(booking.id)).toMatchObject({ status: 'CONFIRMED' });
      const [closed] = await db.select().from(careRequests).where(eq(careRequests.id, first.id));
      expect(closed).toMatchObject({ status: 'CLOSED', closeReason: 'PLACED' });
      expect((await db.select().from(bookingShifts).where(eq(bookingShifts.bookingId, booking.id))).every((s) => s.status === 'SCHEDULED')).toBe(true);

      // Earn it: ten confirmations staff agree with, at a bar of ten.
      await api().patch('/settings/automation').set(bearer(adminToken)).send({ cases: 10 }).expect(200);
      for (let i = 0; i < 9; i++) {
        const d = await app.get(AutomationService).decide({ action: 'booking.confirm', reason: 'The client accepted' });
        await api().post(`/automation/decisions/${d.decisionId}/review`).set(bearer(staffToken)).send({ verdict: 'AGREED' }).expect(200);
      }
      await policy({ autoAllowed: true }).expect(200);

      const second = await matched();
      await sweep(second);
      const [b2] = await bookingsFor(second.id);
      await api().post(`/me/booking-proposals/${b2.id}/accept`).set(bearer(second.clientToken)).expect(200);
      expect(await agent.answers(new Date(), [b2.id])).toMatchObject({ decided: 1, leftToStaff: 0 });
      expect(await bookingRow(b2.id)).toMatchObject({ status: 'CONFIRMED' });
      expect((await confirmDecisions(b2.id))[0]).toMatchObject({ outcome: 'EXECUTED', executionError: null });
      expect((await bookingPanel(b2.id)).handoverNote.done).toBe(`Confirmed ${b2.reference} after the client accepted it; the client and the caregiver have been told`);

      // The caregiver is now busy at those times: a second accepted draft for them cannot be confirmed, and staff are told why.
      const clash = await matched();
      const [offer] = await db.select().from(requestOffers).where(eq(requestOffers.requestId, clash.id));
      await db.update(requestOffers).set({ caregiverId: second.caregiver.id }).where(eq(requestOffers.id, offer.id));
      await db.update(careRequests).set({ caregiverId: second.caregiver.id }).where(eq(careRequests.id, clash.id));
      const d3 = (await api().post('/bookings').set(bearer(staffToken)).send({ careRequestId: clash.id, ...pattern(), rateType: 'DAILY', rateAmount: '3450.00' }).expect(201)).body;
      await api().post(`/bookings/${d3.id}/ask-client`).set(bearer(staffToken)).expect(200);
      await api().post(`/me/booking-proposals/${d3.id}/accept`).set(bearer(clash.clientToken)).expect(200);
      expect(await agent.answers(new Date(), [d3.id])).toMatchObject({ decided: 1, leftToStaff: 1 });
      expect((await bookingRow(d3.id)).status).toBe('DRAFT');
      expect((await confirmDecisions(d3.id))[0].executionError).toBeTruthy();
      expect((await bookingPanel(d3.id)).handoverNote.waiting).toBe('Staff to sort that out and confirm');
      await policy({ autoAllowed: false });
    });

    it('passes a request for changes to staff, and refuses an approval once the draft has changed', async () => {
      await mode('ASSIST');
      const wants = await matched();
      const stale = await matched();
      const a = await staffDraft(wants);
      const b = await staffDraft(stale);
      for (const d of [a, b]) await api().post(`/bookings/${d.id}/ask-client`).set(bearer(staffToken)).expect(200);
      await api().post(`/me/booking-proposals/${a.id}/request-changes`).set(bearer(wants.clientToken)).send({ note: 'Weekends too, please' }).expect(200);
      await api().post(`/me/booking-proposals/${b.id}/accept`).set(bearer(stale.clientToken)).expect(200);
      expect(await agent.answers(new Date(), [a.id, b.id])).toMatchObject({ considered: 2, decided: 1, leftToStaff: 1 });
      expect(await confirmDecisions(a.id)).toHaveLength(0);
      expect((await bookingPanel(a.id)).handoverNote).toMatchObject({ done: 'The client was asked to check the booking and wants changes: "Weekends too, please"', waiting: 'Staff to change the draft and ask the client again' });

      const [proposal] = await confirmDecisions(b.id);
      expect(proposal.outcome).toBe('PROPOSED');
      await api().patch(`/bookings/${b.id}`).set(bearer(staffToken)).send({ rateType: 'DAILY', rateAmount: '3900.00' }).expect(200);
      const res = await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await bookingRow(b.id)).status).toBe('DRAFT');
    });

    it('in Shadow, logs that it would confirm and scores itself against what staff do', async () => {
      await mode('SHADOW');
      const yes = await matched();
      const no = await matched();
      const a = await staffDraft(yes);
      const b = await staffDraft(no);
      for (const [d, r] of [[a, yes], [b, no]] as const) {
        await api().post(`/bookings/${d.id}/ask-client`).set(bearer(staffToken)).expect(200);
        await api().post(`/me/booking-proposals/${d.id}/accept`).set(bearer(r.clientToken)).expect(200);
      }
      expect(await agent.answers(new Date(), [a.id, b.id])).toMatchObject({ decided: 2, scored: 0 });
      expect((await confirmDecisions(a.id))[0].outcome).toBe('SHADOW');
      expect((await bookingRow(a.id)).status).toBe('DRAFT');

      await api().post(`/bookings/${a.id}/confirm`).set(bearer(staffToken)).expect(200);
      await api().post(`/bookings/${b.id}/cancel`).set(bearer(staffToken)).send({ reason: 'The family found someone else' }).expect(200);
      expect(await agent.answers(new Date(), [a.id, b.id])).toMatchObject({ scored: 2, decided: 0 });
      expect((await confirmDecisions(a.id))[0].staffVerdict).toBe('AGREED');
      expect((await confirmDecisions(b.id))[0]).toMatchObject({ staffVerdict: 'DIFFERED', staffNote: 'Scored automatically: staff cancelled the booking instead' });
    });
  });
});
