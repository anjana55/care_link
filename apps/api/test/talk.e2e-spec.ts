import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday, type MyTalkRequest, type StaffTalkRequest } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, patients } from '../src/database/schema';
import { EmailService } from '../src/email/email.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * "Talk to a person": a client or caregiver asks for staff. A case they name
 * is taken over (the agents step back); staff are emailed without the
 * message; staff see it under People waiting and mark it handled.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Talk to a person (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let districtId: number;
  let cityId: number;
  let mail: jest.SpyInstance;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 8800) % 10_000;
  let n = 0;
  const newPhone = () => `070${String(run * 1000 + ++n).padStart(7, '0')}`; // 070: used by no other suite

  async function client() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({
        email: `talk-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone(), consentAccepted: true,
        registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
        preferredContactMethod: 'WHATSAPP', districtId, cityId, careNeeds: 'Needs help with bathing.', careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
      })
      .expect(201);
    const [p] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: p.userId, role: 'PATIENT_GUARDIAN', patientId: p.id }, { secret: accessSecret, expiresIn: '10m' });
    const req = await api().post('/me/care-requests').set(bearer(token)).send({ careType: 'HOME_SHIFT', districtId, cityId }).expect(201);
    return { patientId: p.id, token, requestId: req.body.id as string, reference: req.body.reference as string };
  }

  async function caregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({ phone, consentAccepted: true, fullName: `Talk Caregiver ${phone}`, permanentAddress: '1 Lake Road', dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband' })
      .expect(201);
    const [cg] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE' }).where(eq(caregivers.id, cg.id));
    return { id: cg.id, name: cg.fullName, token: jwt.sign({ sub: cg.userId, role: 'CAREGIVER', caregiverId: cg.id }, { secret: accessSecret, expiresIn: '10m' }) };
  }

  async function booking(patientId: string, caregiverId: string) {
    let d = addDays(colomboToday(), 300 + n);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    const draft = await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({ patientId, caregiverId, scheduleType: 'DAY', daysOfWeek: [1], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: d, endDate: d, rateType: 'DAILY', rateAmount: '3500' })
      .expect(201);
    return draft.body as { id: string; reference: string; shifts: { id: string }[] };
  }

  const ask = (token: string, body: object) => api().post('/me/talk-to-a-person').set(bearer(token)).send(body);
  const caseOf = async (type: string, id: string) => (await api().get(`/automation/cases/${type}/${id}`).set(bearer(staffToken)).expect(200)).body;
  const waiting = async () => (await api().get('/talk-requests').set(bearer(staffToken)).expect(200)).body as StaffTalkRequest[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    staffToken = (await api().post('/auth/login').send({ email: 'staff@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    districtId = tree.flatMap((p) => p.districts)[4].id;
    cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
  });
  beforeEach(() => {
    mail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue(undefined);
  });
  afterEach(() => mail.mockRestore());
  afterAll(() => app.close());

  it('a client asks about their request: the agents step back, staff are told (without the message) and see it waiting', async () => {
    const c = await client();
    const mine = (await ask(c.token, { message: '  My father was taken to hospital, please call me  ', contact: 'CALL', about: { type: 'REQUEST', id: c.requestId } }).expect(201)).body as MyTalkRequest;
    expect(mine).toMatchObject({ message: 'My father was taken to hospital, please call me', contact: 'CALL', status: 'OPEN', handledAt: null });
    expect((await api().get('/me/talk-to-a-person').set(bearer(c.token)).expect(200)).body.map((r: MyTalkRequest) => r.id)).toEqual([mine.id]);

    expect(await caseOf('REQUEST', c.requestId)).toMatchObject({ driver: 'STAFF', takeoverSource: 'PERSON', agentActive: expect.any(Boolean) });
    const sent = mail.mock.calls.filter((x) => x[2] === 'talk to a person');
    expect(sent).toHaveLength(1);
    expect(sent[0][1].subject).toBe('A client asked to talk to a person');
    expect(JSON.stringify(sent[0][1])).toContain(c.reference);
    expect(JSON.stringify(sent[0][1])).not.toMatch(/hospital|Nimal|Sunil/);

    const row = (await waiting()).find((r) => r.id === mine.id)!;
    expect(row).toMatchObject({ role: 'CLIENT', person: { name: 'Nimal Kumara Perera', patientId: c.patientId }, about: { type: 'REQUEST', reference: c.reference, requestId: c.requestId } });
    expect((await api().get('/insights/overview').set(bearer(staffToken)).expect(200)).body.attention.peopleWaiting).toBeGreaterThanOrEqual(1);

    // Staff answer it.
    await api().get('/talk-requests').set(bearer(c.token)).expect(403);
    const done = (await api().post(`/talk-requests/${mine.id}/handled`).set(bearer(staffToken)).send({ note: ' Phoned; moved the start ' }).expect(200)).body as StaffTalkRequest;
    expect(done).toMatchObject({ status: 'HANDLED', staffNote: 'Phoned; moved the start', handledByName: expect.any(String) });
    expect((await api().get('/me/talk-to-a-person').set(bearer(c.token)).expect(200)).body[0]).toMatchObject({ status: 'HANDLED' });
    expect((await waiting()).some((r) => r.id === mine.id)).toBe(false);
  });

  it("refuses someone else's case, a message too short, and more than three waiting", async () => {
    const a = await client();
    const b = await client();
    expect((await ask(a.token, { message: 'Help', contact: 'CALL' }).expect(400)).body.message).toEqual(['Tell us in a few words what you need (up to 1000 characters)']);
    await ask(a.token, { message: 'Please call me back', contact: 'PIGEON' }).expect(400);
    expect((await ask(a.token, { message: 'Please call me back', contact: 'CALL', about: { type: 'REQUEST', id: b.requestId } }).expect(404)).body.message).toBe('We could not find that - choose another, or leave it blank');
    for (let i = 0; i < 3; i++) await ask(a.token, { message: `Please call me back ${i}`, contact: 'WHATSAPP' }).expect(201);
    expect((await ask(a.token, { message: 'Please call me back again', contact: 'WHATSAPP' }).expect(400)).body.message).toBe('We already have your messages - someone will contact you soon');
    // Not linked to a case: nothing is taken over.
    expect((await caseOf('REQUEST', a.requestId)).driver).not.toBe('STAFF');
  });

  it("a caregiver asks about one of their shifts: that booking is taken over; another's shift is not theirs to name", async () => {
    const c = await client();
    const cg = await caregiver();
    const other = await caregiver();
    const b = await booking(c.patientId, cg.id);
    await ask(other.token, { message: 'I have a question about pay', contact: 'CALL', about: { type: 'SHIFT', id: b.shifts[0].id } }).expect(404);
    await ask(cg.token, { message: 'I have a question about this shift', contact: 'WHATSAPP', about: { type: 'SHIFT', id: b.shifts[0].id } }).expect(201);
    expect(await caseOf('BOOKING', b.id)).toMatchObject({ driver: 'STAFF', takeoverSource: 'PERSON' });
    const row = (await waiting()).find((r) => r.person.caregiverId === cg.id)!;
    expect(row).toMatchObject({ role: 'CAREGIVER', about: { type: 'SHIFT', reference: b.reference, bookingId: b.id } });
    expect(mail.mock.calls.filter((x) => x[2] === 'talk to a person')[0][1].subject).toBe('A caregiver asked to talk to a person');
  });
});
