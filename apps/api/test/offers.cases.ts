import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, like, sql } from 'drizzle-orm';
import request from 'supertest';
import type { CaregiverCareOffer, StaffCareOffer } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { careRequests, caregivers, jobs, notifications, patients } from '../src/database/schema';
import { OffersService } from '../src/offers/offers.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * Job offers over real HTTP: staff offer a request to caregivers; a caregiver
 * sees only what they need to decide and answers before the deadline; the
 * first to accept takes the job; and the rates they agreed to are fixed from
 * the moment the offer was sent.
 *
 * Imported by pricing.e2e-spec.ts so both run in one worker: they share the
 * pricing settings table.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Job offers (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let offers: OffersService;
  let staffToken: string;
  let adminToken: string;
  let intake: Record<string, unknown>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 7500) % 10_000;
  let n = 0;
  const newPhone = (prefix = '071') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;
  const sign = (payload: object) => app.get(JwtService).sign(payload, { secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!, expiresIn: '10m' });

  async function newCaregiver(rate?: number) {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Offered Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    const token = sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id });
    if (rate) await api().put(`/caregivers/${row.id}/rates`).set(bearer(token)).send({ rates: [{ careType: 'NURSING_HOME', amount: rate }] }).expect(200);
    return { id: row.id, userId: row.userId!, token };
  }

  /** A phone request for nursing-home care, logged by staff for a new client. */
  async function newRequest(careType: string | null = 'NURSING_HOME') {
    const phone = newPhone('077');
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `offer-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone, consentAccepted: true, ...intake });
    if (reg.status !== 201) throw new Error(`register-patient: ${JSON.stringify(reg.body)}`);
    const res = await api().post('/care-requests').set(bearer(staffToken)).send({ language: 'en', patientId: reg.body.patientId, careType: careType ?? undefined, message: 'Mother needs help after surgery' }).expect(201);
    return { id: res.body.id as string, reference: res.body.reference as string, patientId: reg.body.patientId as string, phone };
  }

  const send = (requestId: string, body: object, token = staffToken) => api().post(`/care-requests/${requestId}/offers`).set(bearer(token)).send(body);
  const mine = async (token: string) => (await api().get('/me/care-offers').set(bearer(token)).expect(200)).body as CaregiverCareOffer[];
  const accept = (id: string, token: string) => api().post(`/me/care-offers/${id}/accept`).set(bearer(token));
  const decline = (id: string, token: string, reason?: string) => api().post(`/me/care-offers/${id}/decline`).set(bearer(token)).send({ reason });
  const staffList = async (requestId: string) => (await api().get(`/care-requests/${requestId}/offers`).set(bearer(staffToken)).expect(200)).body as StaffCareOffer[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    offers = app.get(OffersService);
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
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM care_type_pricing`);
    await api().patch('/settings/pricing/NURSING_HOME').set(bearer(adminToken)).send({ enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 }).expect(200);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM care_type_pricing`);
    await app.close();
  });

  it('offers a request to a caregiver at their own rate, and shows them only what they need to decide', async () => {
    const cg = await newCaregiver(3000);
    const other = await newCaregiver(3200);
    const req = await newRequest();

    await send(req.id, { caregiverId: cg.id }, cg.token).expect(403);
    await send(req.id, { caregiverId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await send(req.id, { caregiverId: cg.id, expiresInMinutes: 5 }).expect(400);

    const sent = (await send(req.id, { caregiverId: cg.id, note: '  Day shifts, starting Monday  ' }).expect(201)).body as StaffCareOffer[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ status: 'OFFERED', rateType: 'DAILY', payRate: 3000, clientRate: 3450, note: 'Day shifts, starting Monday', declineReason: null });
    expect(sent[0].sentByName).toBeTruthy();
    expect(new Date(sent[0].expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
    await send(req.id, { caregiverId: cg.id }).expect(409);

    // The caregiver is told (bell and push), and a job waits to close the offer at its deadline.
    await new Promise((r) => setTimeout(r, 300));
    const told = await db.select().from(notifications).where(and(eq(notifications.userId, cg.userId), eq(notifications.path, '/care-offers')));
    expect(told).toHaveLength(1);
    expect(await db.select().from(jobs).where(eq(jobs.uniqueKey, `offer-expiry:${sent[0].id}`))).toHaveLength(1);

    const [seen] = await mine(cg.token);
    expect(seen).toMatchObject({ id: sent[0].id, reference: req.reference, status: 'OFFERED', careType: 'NURSING_HOME', rateType: 'DAILY', payRate: 3000, note: 'Day shifts, starting Monday' });
    expect(seen.district?.en).toBeTruthy();
    expect(seen.district?.si).toBeTruthy();
    // Nothing about who the client is, what staff were told, or what the client pays.
    const raw = JSON.stringify(seen);
    expect(raw).not.toMatch(/Perera|Fernando|surgery|clientRate|patientId|message|example\.com/);
    // The client's phone number, with or without its leading zero.
    expect(raw).not.toContain(req.phone.slice(1));
    expect(Object.keys(seen).sort()).toEqual(['careType', 'city', 'createdAt', 'desiredStartDate', 'district', 'expiresAt', 'id', 'note', 'payRate', 'rateType', 'reference', 'respondedAt', 'status']);
    expect((await api().get('/me/care-offers/count').set(bearer(cg.token)).expect(200)).body).toEqual({ waiting: 1 });

    // It is theirs alone.
    expect(await mine(other.token)).toHaveLength(0);
    await accept(sent[0].id, other.token).expect(404);
    await decline(sent[0].id, other.token).expect(404);
    await api().get('/me/care-offers').set(bearer(staffToken)).expect(403);
    await api().get('/me/care-offers').expect(401);
  });

  it('gives the job to the first caregiver who accepts and withdraws the rest', async () => {
    const first = await newCaregiver(3000);
    const second = await newCaregiver(3500);
    const req = await newRequest();
    await send(req.id, { caregiverId: first.id }).expect(201);
    const both = (await send(req.id, { caregiverId: second.id }).expect(201)).body as StaffCareOffer[];
    const offerOf = (id: string) => both.find((o) => o.caregiver.id === id)!;

    // The caregiver raises their rate after the offer went out: the offer keeps what was agreed.
    await api().put(`/caregivers/${first.id}/rates`).set(bearer(first.token)).send({ rates: [{ careType: 'NURSING_HOME', amount: 5000 }] }).expect(200);

    const after = (await accept(offerOf(first.id).id, first.token).expect(200)).body as CaregiverCareOffer[];
    expect(after[0]).toMatchObject({ status: 'ACCEPTED', payRate: 3000 });
    expect(after[0].respondedAt).toBeTruthy();
    // Pressing Accept again is harmless.
    await accept(offerOf(first.id).id, first.token).expect(200);

    expect((await accept(offerOf(second.id).id, second.token).expect(409)).body.message).toBe('This job is no longer open');
    expect((await mine(second.token))[0]).toMatchObject({ status: 'WITHDRAWN' });

    const list = await staffList(req.id);
    expect(list.find((o) => o.caregiver.id === first.id)).toMatchObject({ status: 'ACCEPTED', payRate: 3000, clientRate: 3450 });
    expect(list.find((o) => o.caregiver.id === second.id)).toMatchObject({ status: 'WITHDRAWN' });

    // The request now has its caregiver, a note says why, and the booking form can read the agreed rates.
    const detail = (await api().get(`/care-requests/${req.id}`).set(bearer(staffToken)).expect(200)).body;
    expect(detail.caregiver.id).toBe(first.id);
    expect(JSON.stringify(detail.events)).toContain('The caregiver accepted the job offer');
    const agreed = (await api().get(`/care-requests/${req.id}/offers/accepted`).set(bearer(staffToken)).expect(200)).body.offer;
    expect(agreed).toMatchObject({ rateType: 'DAILY', payRate: 3000, clientRate: 3450 });

    // Nobody else can be offered a job that is taken; the expiry jobs are gone; the second caregiver was told.
    await send(req.id, { caregiverId: (await newCaregiver(3000)).id }).expect(400);
    expect(await db.select().from(jobs).where(like(jobs.uniqueKey, `offer-expiry:${offerOf(first.id).id}`))).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(await db.select().from(notifications).where(and(eq(notifications.userId, second.userId), eq(notifications.path, '/care-offers')))).toHaveLength(2);
  });

  it('lets only one of two caregivers win when both accept at the same moment', async () => {
    const a = await newCaregiver(3000);
    const b = await newCaregiver(3000);
    const req = await newRequest();
    await send(req.id, { caregiverId: a.id }).expect(201);
    const list = (await send(req.id, { caregiverId: b.id }).expect(201)).body as StaffCareOffer[];
    const idOf = (cg: string) => list.find((o) => o.caregiver.id === cg)!.id;

    const results = await Promise.all([accept(idOf(a.id), a.token), accept(idOf(b.id), b.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const final = await staffList(req.id);
    expect(final.map((o) => o.status).sort()).toEqual(['ACCEPTED', 'WITHDRAWN']);
    const winner = final.find((o) => o.status === 'ACCEPTED')!.caregiver.id;
    const [row] = await db.select().from(careRequests).where(eq(careRequests.id, req.id));
    expect(row.caregiverId).toBe(winner);
  });

  it('records a decline with its reason, and closes an offer when its time runs out', async () => {
    const cg = await newCaregiver(3000);
    const req = await newRequest();
    const [offer] = (await send(req.id, { caregiverId: cg.id, expiresInMinutes: 10 }).expect(201)).body as StaffCareOffer[];

    await decline(offer.id, cg.token, 'NO_REASON').expect(400);
    const declined = (await decline(offer.id, cg.token, 'TOO_FAR').expect(200)).body as CaregiverCareOffer[];
    expect(declined[0].status).toBe('DECLINED');
    expect((await staffList(req.id))[0]).toMatchObject({ status: 'DECLINED', declineReason: 'TOO_FAR' });
    await accept(offer.id, cg.token).expect(400);
    await decline(offer.id, cg.token).expect(400);

    // A second offer to the same caregiver is fine once the first is answered. This one runs out.
    const again = (await send(req.id, { caregiverId: cg.id, expiresInMinutes: 10 }).expect(201)).body as StaffCareOffer[];
    const late = again.find((o) => o.status === 'OFFERED')!;
    const afterDeadline = new Date(Date.now() + 11 * 60_000);
    // Past its deadline it reads as expired and cannot be accepted, even before the clean-up job has run.
    expect((await offers.forRequest(req.id)).find((o) => o.id === late.id)!.status).toBe('OFFERED');
    await expect(offers.accept({ userId: cg.userId, email: null, role: 'CAREGIVER', caregiverId: cg.id }, late.id, afterDeadline)).rejects.toThrow('The time to answer this offer has passed');
    expect(await offers.expire(late.id)).toBe(false); // not yet due
    expect(await offers.expire(late.id, afterDeadline)).toBe(true);
    expect(await offers.expire(late.id, afterDeadline)).toBe(false);
    expect((await mine(cg.token)).find((o) => o.id === late.id)!.status).toBe('EXPIRED');
    expect((await api().get('/me/care-offers/count').set(bearer(cg.token)).expect(200)).body).toEqual({ waiting: 0 });
    // The request is still without a caregiver.
    const [row] = await db.select().from(careRequests).where(eq(careRequests.id, req.id));
    expect(row.caregiverId).toBeNull();
  });

  it('lets staff withdraw an offer, type a rate when the caregiver has none, or leave it to be agreed', async () => {
    const noRate = await newCaregiver();
    const req = await newRequest();

    await send(req.id, { caregiverId: noRate.id, payRate: 2800 }).expect(400); // per what?
    const typed = (await send(req.id, { caregiverId: noRate.id, payRate: 2800, rateType: 'DAILY' }).expect(201)).body as StaffCareOffer[];
    expect(typed[0]).toMatchObject({ rateType: 'DAILY', payRate: 2800, clientRate: null });

    const gone = (await api().post(`/care-requests/${req.id}/offers/${typed[0].id}/withdraw`).set(bearer(staffToken)).expect(200)).body as StaffCareOffer[];
    expect(gone[0].status).toBe('WITHDRAWN');
    await api().post(`/care-requests/${req.id}/offers/${typed[0].id}/withdraw`).set(bearer(staffToken)).expect(400);
    await accept(typed[0].id, noRate.token).expect(409);

    // A request with no kind of care has nothing to quote from: the offer says the rate is to be agreed.
    const vague = await newRequest(null);
    const open = (await send(vague.id, { caregiverId: noRate.id }).expect(201)).body as StaffCareOffer[];
    expect(open[0]).toMatchObject({ rateType: null, payRate: null, clientRate: null });
    expect((await mine(noRate.token)).find((o) => o.id === open[0].id)).toMatchObject({ careType: null, payRate: null });

    // Once the request is closed, nothing more can be offered or accepted.
    await db.execute(sql`UPDATE care_requests SET status = 'CANCELLED' WHERE id = ${vague.id}`);
    await send(vague.id, { caregiverId: (await newCaregiver()).id }).expect(400);
    await accept(open[0].id, noRate.token).expect(409);
    void patients;
  });
});
