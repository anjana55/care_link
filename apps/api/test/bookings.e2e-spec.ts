import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoToColomboLocal, isoWeekday } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, patients } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * Bookings and shifts over real HTTP: staff build a booking from a pattern,
 * shape its draft shifts, confirm it; the client and caregiver then see their
 * confirmed shifts and nothing else. Above all: a caregiver can never be held
 * by two overlapping shifts.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Bookings and shifts (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let verifierToken: string;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `072${String(run * 1000 + ++n).padStart(7, '0')}`;

  /** The Monday at least a week from now (Colombo), so every generated shift is in the future. */
  const nextMonday = (() => {
    let d = addDays(colomboToday(), 7);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  })();
  /** Each test books its own fortnight, so tests sharing a caregiver never collide by accident. */
  let weekOffset = 0;
  const freshMonday = () => addDays(nextMonday, 7 * 3 * weekOffset++);

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Booked Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = 'ACTIVE' WHERE id = ${row.id}`);
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, publicId: row.publicId, fullName: row.fullName, token };
  }

  async function newClient() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `booking-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Booking Client', phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, token };
  }

  const pattern = (startDate: string, extra: Record<string, unknown> = {}) => ({
    scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate, endDate: addDays(startDate, 13), ...extra,
  });
  const book = (body: Record<string, unknown>, token = staffToken) => api().post('/bookings').set(bearer(token)).send(body);
  const confirm = (id: string) => api().post(`/bookings/${id}/confirm`).set(bearer(staffToken));
  const editShift = (id: string, shiftId: string, body: Record<string, unknown>) =>
    api().patch(`/bookings/${id}/shifts/${shiftId}`).set(bearer(staffToken)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    verifierToken = (await login('verifier@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('turns an introduced request into a draft booking, confirms it, and closes the request as placed', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const req = await api().post('/me/care-requests').set(bearer(client.token)).set('Accept-Language', 'ta').send({ caregiverPublicId: cg.publicId }).expect(201);
    await api().patch(`/care-requests/${req.body.id}/status`).set(bearer(staffToken)).send({ status: 'IN_PROGRESS' }).expect(200);
    await api().patch(`/care-requests/${req.body.id}/status`).set(bearer(staffToken)).send({ status: 'INTRODUCED' }).expect(200);

    const monday = freshMonday();
    const draft = await book({ careRequestId: req.body.id, ...pattern(monday), rateType: 'DAILY', rateAmount: '3500' }).expect(201);
    expect(draft.body.reference).toMatch(/^BK-[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.client.id).toBe(client.patientId);
    expect(draft.body.caregiver.id).toBe(cg.id);
    expect(draft.body.language).toBe('ta');
    expect(draft.body.shifts).toHaveLength(10);
    expect(draft.body.shifts.every((s: { status: string }) => s.status === 'DRAFT')).toBe(true);
    expect(isoToColomboLocal(draft.body.shifts[0].startsAt)).toBe(`${monday}T08:00`);
    expect(draft.body.estimate).toMatchObject({ shifts: 10, hours: 90, total: '35000.00' });

    // Drafts are invisible to the client and the caregiver.
    expect((await api().get('/me/bookings').set(bearer(client.token)).expect(200)).body).toEqual([]);
    expect((await api().get('/me/shifts').set(bearer(cg.token)).expect(200)).body).toEqual([]);

    // Shape the roster: one shift starts later, one extra Saturday, one day off.
    const [first, second] = draft.body.shifts;
    await editShift(draft.body.id, first.id, { start: `${monday}T09:30`, end: `${monday}T18:00` }).expect(200);
    await api().post(`/bookings/${draft.body.id}/shifts`).set(bearer(staffToken)).send({ start: `${addDays(monday, 5)}T08:00`, end: `${addDays(monday, 5)}T13:00` }).expect(201);
    const shaped = await api().delete(`/bookings/${draft.body.id}/shifts/${second.id}`).set(bearer(staffToken)).expect(200);
    expect(shaped.body.shifts).toHaveLength(10);
    expect(isoToColomboLocal(shaped.body.shifts[0].startsAt)).toBe(`${monday}T09:30`);

    const confirmed = await confirm(draft.body.id).expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.shifts.every((s: { status: string }) => s.status === 'SCHEDULED')).toBe(true);
    const reqAfter = await api().get(`/care-requests/${req.body.id}`).set(bearer(staffToken)).expect(200);
    expect(reqAfter.body.status).toBe('CLOSED');
    expect(reqAfter.body.closeReason).toBe('PLACED');

    // The client sees the booking and its shifts - the caregiver only by public profile.
    const mine = await api().get('/me/bookings').set(bearer(client.token)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].shifts).toHaveLength(10);
    expect(mine.body[0].caregiver.publicId).toBe(cg.publicId);
    expect(JSON.stringify(mine.body)).not.toContain(cg.fullName);
    // The caregiver sees their shifts with the area, not the client.
    const theirs = await api().get('/me/shifts').set(bearer(cg.token)).expect(200);
    expect(theirs.body).toHaveLength(10);
    expect(theirs.body[0]).toMatchObject({ bookingReference: confirmed.body.reference, isCover: false });
    expect(theirs.body[0].area).toBeTruthy();
    expect(JSON.stringify(theirs.body)).not.toContain('Booking Client');
    expect(JSON.stringify(theirs.body)).not.toContain('Sunil');

    // A confirmed booking's pattern is fixed; a draft's isn't.
    await api().patch(`/bookings/${draft.body.id}`).set(bearer(staffToken)).send({ pattern: pattern(monday) }).expect(400);
  });

  it('never lets one caregiver hold two overlapping shifts', async () => {
    const cg = await newCaregiver();
    const cover = await newCaregiver();
    const [c1, c2] = [await newClient(), await newClient()];
    const monday = freshMonday();

    const a = await book({ patientId: c1.patientId, caregiverId: cg.id, ...pattern(monday) }).expect(201);
    await confirm(a.body.id).expect(200);

    // A night booking for the same person, overlapping only the first Monday's evening.
    const b = await book({
      patientId: c2.patientId, caregiverId: cg.id, scheduleType: 'CUSTOM', daysOfWeek: [1], shiftStartTime: '16:00', shiftEndTime: '20:00', startDate: monday, endDate: monday,
    }).expect(201);
    expect(b.body.blockingConflicts).toBe(1);
    expect(b.body.shifts[0].conflicts[0]).toMatchObject({ kind: 'BLOCKING', withBookingReference: a.body.reference });
    const refused = await confirm(b.body.id).expect(409);
    expect(refused.body.message).toContain(a.body.reference);

    // Moving it to start after the day shift ends (back to back is fine) resolves it...
    const moved = await editShift(b.body.id, b.body.shifts[0].id, { start: `${monday}T17:00`, end: `${monday}T21:00` }).expect(200);
    expect(moved.body.blockingConflicts).toBe(0);
    await confirm(b.body.id).expect(200);
    // ...and a scheduled shift cannot then be dragged back over it.
    await editShift(b.body.id, b.body.shifts[0].id, { start: `${monday}T16:00` }).expect(409);

    // A cover caregiver takes one of the day shifts; the booked caregiver could then do something else then.
    const day2 = (await api().get(`/bookings/${a.body.id}`).set(bearer(staffToken))).body.shifts[1];
    const covered = await editShift(a.body.id, day2.id, { caregiverId: cover.id }).expect(200);
    expect(covered.body.shifts[1]).toMatchObject({ isCover: true });
    expect((await api().get('/me/shifts').set(bearer(cover.token)).expect(200)).body).toEqual([expect.objectContaining({ isCover: true })]);

    // Two confirms racing for the same slot: exactly one wins.
    const [x, y] = [await newClient(), await newClient()];
    const slot = { scheduleType: 'CUSTOM', daysOfWeek: [6], shiftStartTime: '08:00', shiftEndTime: '12:00', startDate: addDays(monday, 5), endDate: addDays(monday, 5) };
    const bx = await book({ patientId: x.patientId, caregiverId: cover.id, ...slot }).expect(201);
    const by = await book({ patientId: y.patientId, caregiverId: cover.id, ...slot }).expect(201);
    const results = await Promise.all([confirm(bx.body.id), confirm(by.body.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('tracks what happened to each shift, and extends, completes and cancels bookings', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    // A booking that started last week: some shifts are already in the past.
    const lastMonday = (() => {
      let d = addDays(colomboToday(), -7);
      while (isoWeekday(d) !== 1) d = addDays(d, -1);
      return d;
    })();
    const past = await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(lastMonday, { endDate: addDays(lastMonday, 4) }) }).expect(201);
    await confirm(past.body.id).expect(200);
    const s0 = past.body.shifts[0];
    await editShift(past.body.id, s0.id, { status: 'COMPLETED' }).expect(200);
    await editShift(past.body.id, past.body.shifts[1].id, { status: 'MISSED', note: 'Caregiver unwell' }).expect(200);
    await editShift(past.body.id, s0.id, { status: 'DRAFT' }).expect(400);
    await api().delete(`/bookings/${past.body.id}/shifts/${s0.id}`).set(bearer(staffToken)).expect(400);

    const monday = freshMonday();
    const future = await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { endDate: addDays(monday, 4) }) }).expect(201);
    await confirm(future.body.id).expect(200);
    await editShift(future.body.id, future.body.shifts[0].id, { status: 'COMPLETED' }).expect(400); // not started yet
    await editShift(future.body.id, future.body.shifts[0].id, { status: 'CANCELLED' }).expect(200);
    await editShift(future.body.id, future.body.shifts[0].id, { status: 'SCHEDULED' }).expect(200);

    const extended = await api().post(`/bookings/${future.body.id}/extend`).set(bearer(staffToken)).send({ endDate: addDays(monday, 11) }).expect(200);
    expect(extended.body.shifts).toHaveLength(10);
    expect(extended.body.shifts.at(-1).status).toBe('SCHEDULED');
    await api().post(`/bookings/${future.body.id}/extend`).set(bearer(staffToken)).send({ endDate: monday }).expect(400);

    const cancelled = await api().post(`/bookings/${future.body.id}/cancel`).set(bearer(staffToken)).send({ reason: 'Family moved to Galle' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.shifts.every((s: { status: string }) => s.status === 'CANCELLED')).toBe(true);
    await editShift(future.body.id, future.body.shifts[1].id, { status: 'SCHEDULED' }).expect(400);

    const done = await api().post(`/bookings/${past.body.id}/complete`).set(bearer(staffToken)).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.shifts[0].status).toBe('COMPLETED');
    expect(done.body.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['CREATED', 'CONFIRMED', 'SHIFT_CHANGED', 'COMPLETED']));
  });

  it('regenerates a draft from a new pattern, and validates patterns and shifts', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const monday = freshMonday();
    const draft = await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday) }).expect(201);
    const live = await api()
      .patch(`/bookings/${draft.body.id}`)
      .set(bearer(staffToken))
      .send({ pattern: { scheduleType: 'LIVE_IN', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], shiftStartTime: '08:00', shiftEndTime: '08:00', startDate: monday, endDate: addDays(monday, 6) }, rateType: 'MONTHLY', rateAmount: '90000' })
      .expect(200);
    expect(live.body.shifts).toHaveLength(7);
    expect(live.body.shifts[0].hours).toBe(24);
    expect(live.body.estimate.total).toBe('21000.00');

    const id = draft.body.id;
    const shift = live.body.shifts[0].id;
    await editShift(id, shift, { start: `${monday}T08:00`, end: `${addDays(monday, 1)}T09:00` }).expect(400); // 25 hours
    await editShift(id, shift, { start: `${monday}T10:00`, end: `${monday}T09:00` }).expect(400);
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { endDate: addDays(monday, -1) }) }).expect(400);
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { daysOfWeek: [] }) }).expect(400);
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { endDate: addDays(monday, 400) }) }).expect(400);
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { shiftStartTime: '8am' }) }).expect(400);
    // Saturday and Sunday only, within a Monday-to-Friday range: nothing to book.
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { daysOfWeek: [6, 7], endDate: addDays(monday, 4) }) }).expect(400);
  });

  it('is for admin and staff; the portals only see their own', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(freshMonday()) }, verifierToken).expect(403);
    await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(freshMonday()) }, client.token).expect(403);
    await api().get('/bookings').set(bearer(cg.token)).expect(403);
    await api().get('/me/shifts').set(bearer(client.token)).expect(403);
    await api().get('/me/bookings').set(bearer(cg.token)).expect(403);
    const list = await api().get(`/bookings?patientId=${client.patientId}`).set(bearer(adminToken)).expect(200);
    expect(list.body.total).toBe(0);
    expect((await api().get('/bookings/summary').set(bearer(staffToken)).expect(200)).body.byStatus).toHaveProperty('CONFIRMED');
  });

  it('keeps caregivers already booked on the requested start date out of search', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const monday = freshMonday();
    const b = await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(monday, { endDate: monday }) }).expect(201);
    const search = (date: string) =>
      api()
        .post('/public/search')
        .send({ location: { districtId: (intake as { districtId: number }).districtId, cityId: (intake as { cityId: number }).cityId }, desiredStartDate: date, page: 1, pageSize: 50 });
    const ids = async (date: string) => {
      const res = await search(date).expect(200);
      return res.body.items.map((i: { publicId: string }) => i.publicId);
    };
    // Make sure they'd otherwise match on location.
    await db.execute(sql`UPDATE caregivers SET district_id = ${(intake as { districtId: number }).districtId}, city_id = ${(intake as { cityId: number }).cityId} WHERE id = ${cg.id}`);
    expect(await ids(monday)).toContain(cg.publicId); // a draft doesn't block
    await confirm(b.body.id).expect(200);
    expect(await ids(monday)).not.toContain(cg.publicId);
    expect(await ids(addDays(monday, 1))).toContain(cg.publicId);
  });

  it("removes a client's bookings with the client", async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const b = await book({ patientId: client.patientId, caregiverId: cg.id, ...pattern(freshMonday()) }).expect(201);
    await confirm(b.body.id).expect(200);
    await api().delete(`/patients/${client.patientId}`).set(bearer(adminToken)).expect(200);
    await api().get(`/bookings/${b.body.id}`).set(bearer(staffToken)).expect(404);
    expect((await api().get('/me/shifts').set(bearer(cg.token)).expect(200)).body).toEqual([]);
  });
});
