import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday, type CaregiverShift, type ClientBooking, type StaffCheckIn, type TodayVisits } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { bookingShifts, caregivers, patients, shiftCheckins } from '../src/database/schema';
import { NotificationsService } from '../src/notifications/notifications.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * Shift check-in over real HTTP and MySQL: off until an admin switches it on;
 * the client reads the caregiver a four-digit code at the door; the caregiver
 * never sees that code anywhere; five wrong tries lock it; staff can always
 * record the visit by hand; and none of it changes the shift.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Shift check-in (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 7300) % 10_000;
  let n = 0;
  const newPhone = (prefix = '071') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;
  const minutes = (m: number) => new Date(Date.now() + m * 60_000);
  /** A Monday a good while off, a different one each time, so bookings never collide. */
  let weekOffset = 0;
  const freshMonday = () => {
    let d = addDays(colomboToday(), 14 + 21 * weekOffset++);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  };

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Visiting Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy', dateOfBirth: '1988-01-20', gender: 'FEMALE',
        civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE' }).where(eq(caregivers.id, row.id));
    return { id: row.id, token: jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' }) };
  }

  /**
   * A confirmed booking of two day shifts with its own client and caregiver.
   * The first shift is then moved to start `startsIn` minutes from now (four
   * hours long), the second to the same time a day later.
   */
  async function visit(startsIn: number) {
    const cg = await newCaregiver();
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `visit-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Perera', phone: newPhone('077'), consentAccepted: true, ...intake })
      .expect(201);
    const [patient] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const clientToken = jwt.sign({ sub: patient.userId, role: 'PATIENT_GUARDIAN', patientId: patient.id }, { secret: accessSecret, expiresIn: '10m' });
    const monday = freshMonday();
    const draft = await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({ patientId: patient.id, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: monday, endDate: addDays(monday, 1), rateType: 'DAILY', rateAmount: '3500' })
      .expect(201);
    const booking = (await api().post(`/bookings/${draft.body.id}/confirm`).set(bearer(staffToken)).expect(200)).body;
    const [first, second] = booking.shifts as { id: string }[];
    await db.update(bookingShifts).set({ startsAt: minutes(startsIn), endsAt: minutes(startsIn + 240) }).where(eq(bookingShifts.id, first.id));
    await db.update(bookingShifts).set({ startsAt: minutes(startsIn + 1440), endsAt: minutes(startsIn + 1680) }).where(eq(bookingShifts.id, second.id));
    return { bookingId: booking.id as string, reference: booking.reference as string, shiftId: first.id, nextShiftId: second.id, cg, clientToken, patientUserId: patient.userId };
  }

  const setting = (body: object, token = adminToken) => api().patch('/settings/check-in').set(bearer(token)).send(body);
  const myShift = async (token: string, shiftId: string) => ((await api().get('/me/shifts').set(bearer(token)).expect(200)).body as CaregiverShift[]).find((s) => s.id === shiftId)!;
  const clientShift = async (token: string, shiftId: string) =>
    ((await api().get('/me/bookings').set(bearer(token)).expect(200)).body as ClientBooking[]).flatMap((b) => b.shifts).find((s) => s.id === shiftId)!;
  const staffShift = async (bookingId: string, shiftId: string) =>
    ((await api().get(`/bookings/${bookingId}`).set(bearer(staffToken)).expect(200)).body.shifts as { id: string; status: string; checkIn: StaffCheckIn | null }[]).find((s) => s.id === shiftId)!;
  const checkIn = (token: string, shiftId: string, body: object) => api().post(`/me/shifts/${shiftId}/check-in`).set(bearer(token)).send(body);
  const checkOut = (token: string, shiftId: string, body: object = {}) => api().post(`/me/shifts/${shiftId}/check-out`).set(bearer(token)).send(body);
  const wrong = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, '0');

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
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await setting({ enabled: false, earlyMinutes: 60, lateAfterMinutes: 15 }).expect(200);
  });

  afterAll(async () => {
    await setting({ enabled: false, earlyMinutes: 60, lateAfterMinutes: 15 });
    await app.close();
  });

  it('is off until an admin switches it on: no code, no button, and both routes refuse', async () => {
    const v = await visit(10);
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toBeNull();
    expect((await clientShift(v.clientToken, v.shiftId)).visit).toBeNull();
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn).toBeNull();
    expect((await checkIn(v.cg.token, v.shiftId, { code: '1234' }).expect(400)).body.message).toBe('Check-in is not switched on');
    await checkOut(v.cg.token, v.shiftId).expect(400);
    await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(staffToken)).send({}).expect(400);
    // Today's visits still lists the day for staff, with nothing recorded.
    const today = (await api().get('/visits/today').set(bearer(staffToken)).expect(200)).body as TodayVisits;
    expect(today.settings.enabled).toBe(false);

    // Only an admin changes the setting, within limits.
    await setting({ enabled: true }, staffToken).expect(403);
    await setting({ earlyMinutes: 500 }).expect(400);
    await setting({ lateAfterMinutes: 1 }).expect(400);
    expect((await setting({ enabled: true }).expect(200)).body).toMatchObject({ enabled: true, earlyMinutes: 60, lateAfterMinutes: 15 });
  });

  it('checks a caregiver in with the code the client reads out, and out again, without touching the shift', async () => {
    await setting({ enabled: true }).expect(200);
    const v = await visit(30);
    const notify = jest.spyOn(app.get(NotificationsService), 'notify');

    // The client has the code; staff see the same one; the caregiver sees only that check-in is open.
    const code = (await clientShift(v.clientToken, v.shiftId)).visit!.arrivalCode!;
    expect(code).toMatch(/^\d{4}$/);
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn).toMatchObject({ state: 'DUE', arrivalCode: code, wrongCodes: 0, checkedInAt: null });
    const mine = await myShift(v.cg.token, v.shiftId);
    expect(mine.checkIn).toMatchObject({ state: 'DUE', checkedInAt: null, checkedOutAt: null, codeLocked: false });
    expect(JSON.stringify((await api().get('/me/shifts').set(bearer(v.cg.token)).expect(200)).body)).not.toContain(code);
    // Tomorrow's shift: a different code, not shown to the client yet, and too early to check in.
    expect((await clientShift(v.clientToken, v.nextShiftId)).visit).toEqual({ arrivalCode: null, checkedInAt: null, checkedOutAt: null });
    expect((await staffShift(v.bookingId, v.nextShiftId)).checkIn!.arrivalCode).not.toBe(code);
    expect((await myShift(v.cg.token, v.nextShiftId)).checkIn!.state).toBe('UPCOMING');
    expect((await checkIn(v.cg.token, v.nextShiftId, { code }).expect(400)).body.message).toBe('It is too early to check in for this shift');

    // No code, a short one, somebody else's shift, a wrong one.
    await checkIn(v.cg.token, v.shiftId, {}).expect(400);
    expect((await checkIn(v.cg.token, v.shiftId, { code: '12' }).expect(400)).body.message).toEqual(['Enter the 4-digit code the client gives you']);
    const stranger = await newCaregiver();
    await checkIn(stranger.token, v.shiftId, { code }).expect(404);
    await checkOut(v.cg.token, v.shiftId).expect(400);
    expect((await checkIn(v.cg.token, v.shiftId, { code: wrong(code) }).expect(400)).body.message).toBe('That code is not right - ask the client to read it to you again');
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn).toMatchObject({ wrongCodes: 1, checkedInAt: null });
    expect(notify).not.toHaveBeenCalledWith([v.patientUserId], expect.anything(), '/bookings', expect.stringContaining('arrived'));

    // The right one, typed with a space, with where the phone is.
    await checkIn(v.cg.token, v.shiftId, { code: `${code.slice(0, 2)} ${code.slice(2)}`, latitude: 6.9271, longitude: 79.8612, accuracyM: 12.4 }).expect(200);
    const seen = (await staffShift(v.bookingId, v.shiftId));
    expect(seen.status).toBe('SCHEDULED');
    expect(seen.checkIn).toMatchObject({ state: 'IN', inBy: 'CAREGIVER', inLocation: { latitude: 6.9271, longitude: 79.8612, accuracyM: 12 }, inDistanceM: null, checkedOutAt: null });
    expect(seen.checkIn!.inByName).toMatch(/Visiting Caregiver/);
    // The client is told, and their code is gone: it has done its job.
    expect(notify).toHaveBeenCalledWith([v.patientUserId], expect.any(Function), '/bookings', `arrived ${v.shiftId}`);
    const text = (notify.mock.calls.find((c) => c[3] === `arrived ${v.shiftId}`)![1] as (l: 'en') => { title: string; body: string })('en');
    expect(text.title).toBe('Your caregiver has arrived');
    expect(text.body).toMatch(/^They checked in at \d{2}:\d{2}\.$/);
    const visitNow = (await clientShift(v.clientToken, v.shiftId)).visit!;
    expect(visitNow.arrivalCode).toBeNull();
    expect(visitNow.checkedInAt).toBe(seen.checkIn!.checkedInAt);
    // A second tap changes nothing and tells nobody twice.
    await checkIn(v.cg.token, v.shiftId, { code }).expect(200);
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn!.checkedInAt).toBe(seen.checkIn!.checkedInAt);
    expect(notify.mock.calls.filter((c) => c[3] === `arrived ${v.shiftId}`)).toHaveLength(1);
    notify.mockRestore();

    // Out again.
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toMatchObject({ state: 'IN' });
    await checkOut(v.cg.token, v.shiftId, { latitude: 6.9272, longitude: 79.8613 }).expect(200);
    await checkOut(v.cg.token, v.shiftId).expect(200);
    const done = await staffShift(v.bookingId, v.shiftId);
    expect(done.status).toBe('SCHEDULED');
    expect(done.checkIn).toMatchObject({ state: 'OUT', outBy: 'CAREGIVER', outLocation: { latitude: 6.9272, longitude: 79.8613, accuracyM: null } });
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toMatchObject({ state: 'OUT' });
    expect((await clientShift(v.clientToken, v.shiftId)).visit!.checkedOutAt).toBe(done.checkIn!.checkedOutAt);
  });

  it('points out a check-in far from where the booking\'s earlier visits checked in, and checks in without a position', async () => {
    await setting({ enabled: true }).expect(200);
    const v = await visit(5);
    const code = (id: string) => staffShift(v.bookingId, id).then((s) => s.checkIn!.arrivalCode);
    await checkIn(v.cg.token, v.shiftId, { code: await code(v.shiftId), latitude: 6.9271, longitude: 79.8612 }).expect(200);
    // The next day, about a kilometre north.
    await db.update(bookingShifts).set({ startsAt: minutes(5), endsAt: minutes(200) }).where(eq(bookingShifts.id, v.nextShiftId));
    await checkIn(v.cg.token, v.nextShiftId, { code: await code(v.nextShiftId), latitude: 6.9361, longitude: 79.8612 }).expect(200);
    const far = (await staffShift(v.bookingId, v.nextShiftId)).checkIn!;
    expect(far.inDistanceM).toBeGreaterThan(950);
    expect(far.inDistanceM).toBeLessThan(1050);

    // A phone that cannot say where it is still checks in; nonsense coordinates are refused.
    const w = await visit(5);
    const theirs = (await staffShift(w.bookingId, w.shiftId)).checkIn!.arrivalCode;
    await checkIn(w.cg.token, w.shiftId, { code: theirs, latitude: 123, longitude: 79 }).expect(400);
    await checkIn(w.cg.token, w.shiftId, { code: theirs }).expect(200);
    expect((await staffShift(w.bookingId, w.shiftId)).checkIn).toMatchObject({ state: 'IN', inLocation: null, inDistanceM: null });
  });

  it('locks the code after five wrong tries; staff then record the visit by hand', async () => {
    await setting({ enabled: true }).expect(200);
    const v = await visit(-20); // started twenty minutes ago
    const code = (await staffShift(v.bookingId, v.shiftId)).checkIn!.arrivalCode;
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn!.state).toBe('LATE');
    for (let i = 0; i < 4; i++) expect((await checkIn(v.cg.token, v.shiftId, { code: wrong(code) }).expect(400)).body.message).toMatch(/^That code is not right/);
    expect((await checkIn(v.cg.token, v.shiftId, { code: wrong(code) }).expect(400)).body.message).toBe('Too many wrong codes - ask the office to check you in');
    // Even the right code is refused now.
    expect((await checkIn(v.cg.token, v.shiftId, { code }).expect(400)).body.message).toBe('Too many wrong codes - ask the office to check you in');
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toMatchObject({ state: 'LATE', codeLocked: true });
    expect((await staffShift(v.bookingId, v.shiftId)).checkIn).toMatchObject({ wrongCodes: 5, codeLocked: true });

    // It shows as late on today's list and in the dashboard's count.
    const today = (await api().get('/visits/today').set(bearer(staffToken)).expect(200)).body as TodayVisits;
    const row = today.visits.find((x) => x.shiftId === v.shiftId)!;
    expect(row).toMatchObject({ bookingReference: v.reference, shiftStatus: 'SCHEDULED', isCover: false, client: { fullName: 'Nimal Perera', recipientName: 'Sunil Fernando' }, checkIn: { state: 'LATE', codeLocked: true } });
    expect(row.minutesLate).toBeGreaterThanOrEqual(19); // the shift's start is stored to the second
    expect(row.caregiver.fullName).toMatch(/Visiting Caregiver/);
    expect(today.visits.map((x) => x.startsAt)).toEqual([...today.visits.map((x) => x.startsAt)].sort());
    const overview = (await api().get('/insights/overview').set(bearer(staffToken)).expect(200)).body;
    expect(overview.attention.lateVisits).toBeGreaterThanOrEqual(1);
    await api().get('/visits/today').set(bearer(v.cg.token)).expect(403);

    // Staff record it: the caregiver phoned at ten past.
    const at = minutes(-10).toISOString();
    await api().post(`/visits/${v.shiftId}/check-out`).set(bearer(staffToken)).send({}).expect(400);
    await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(staffToken)).send({ at: minutes(10).toISOString() }).expect(400);
    await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(v.cg.token)).send({}).expect(403);
    const recorded = (await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(staffToken)).send({ at, note: ' Phoned from the house; the client could not find her phone ' }).expect(200)).body as StaffCheckIn;
    expect(recorded).toMatchObject({ state: 'IN', inBy: 'STAFF', inNote: 'Phoned from the house; the client could not find her phone', checkedInAt: at, codeLocked: false, inLocation: null });
    expect(recorded.inByName).toBeTruthy();
    await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(staffToken)).send({}).expect(400);
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toMatchObject({ state: 'IN', codeLocked: false });
    // No longer late.
    expect(((await api().get('/visits/today').set(bearer(staffToken)).expect(200)).body as TodayVisits).visits.find((x) => x.shiftId === v.shiftId)).toMatchObject({ minutesLate: null, checkIn: { state: 'IN' } });

    // Out: not before they came in; the caregiver can still do that part themselves.
    await api().post(`/visits/${v.shiftId}/check-out`).set(bearer(staffToken)).send({ at: minutes(-15).toISOString() }).expect(400);
    const out = (await api().post(`/visits/${v.shiftId}/check-out`).set(bearer(staffToken)).send({ note: 'Left at the usual time' }).expect(200)).body as StaffCheckIn;
    expect(out).toMatchObject({ state: 'OUT', outBy: 'STAFF', outNote: 'Left at the usual time' });
    await api().post(`/visits/${v.shiftId}/check-out`).set(bearer(staffToken)).send({}).expect(400);
  });

  it('refuses a check-in once the shift has ended, and on a shift that is not scheduled', async () => {
    await setting({ enabled: true }).expect(200);
    const v = await visit(-300); // ended an hour ago
    const code = (await staffShift(v.bookingId, v.shiftId)).checkIn!.arrivalCode;
    expect((await myShift(v.cg.token, v.shiftId)).checkIn).toMatchObject({ state: 'NOT_RECORDED' });
    expect((await clientShift(v.clientToken, v.shiftId)).visit!.arrivalCode).toBeNull();
    expect((await checkIn(v.cg.token, v.shiftId, { code }).expect(400)).body.message).toBe('This shift has ended - ask the office to record your visit');
    // Staff still can, after the fact.
    await api().post(`/visits/${v.shiftId}/check-in`).set(bearer(staffToken)).send({ at: minutes(-295).toISOString() }).expect(200);

    const w = await visit(10);
    await api().patch(`/bookings/${w.bookingId}/shifts/${w.shiftId}`).set(bearer(staffToken)).send({ status: 'CANCELLED', note: 'The family is away' }).expect(200);
    await checkIn(w.cg.token, w.shiftId, { code: '0000' }).expect(400);
    await api().post(`/visits/${w.shiftId}/check-in`).set(bearer(staffToken)).send({}).expect(400);
    expect(await db.select().from(shiftCheckins).where(eq(shiftCheckins.shiftId, w.shiftId))).toHaveLength(0);
  });
});
