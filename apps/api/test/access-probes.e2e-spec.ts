import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { bookingShifts, bookings, careRequests, caregivers, invoices, patients } from '../src/database/schema';
import { InvoicesService } from '../src/billing/invoices.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * Security probes: one client and one caregiver try to reach another
 * client's and another caregiver's records through every self-service route
 * that takes an id. Each must be refused (403 or 404) and change nothing,
 * and the refusal must look the same as for an id that does not exist, so
 * it gives away nothing about whether the record is there.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Access probes: one account against another (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 100_000;
  let n = 0;
  /** A number nobody holds yet (prefixes are shared between suites). */
  const newPhone = async (prefix: string) => {
    for (;;) {
      const p = `${prefix}${String((run % 1000) * 10_000 + ++n + 7000).padStart(7, '0')}`;
      const [taken] = (await db.execute(sql`SELECT id FROM users WHERE phone = ${`+94${p.slice(1)}`} LIMIT 1`)) as unknown as [unknown[]];
      if (!taken.length) return p;
    }
  };
  let weekOffset = 0;
  const freshMonday = () => {
    let d = addDays(colomboToday(), 400 + 21 * weekOffset++ + (run % 50) * 7);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  };
  const NOBODY = '00000000-0000-4000-8000-000000000000';

  async function newCaregiver() {
    const phone = await newPhone('072');
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Probe Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy', dateOfBirth: '1988-01-20', gender: 'FEMALE',
        civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE' }).where(eq(caregivers.id, row.id));
    return { id: row.id, publicId: row.publicId, token: jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' }) };
  }

  async function newClient() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `probe-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Perera', phone: await newPhone('077'), consentAccepted: true, ...intake })
      .expect(201);
    const [p] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    return { patientId: p.id, token: jwt.sign({ sub: p.userId, role: 'PATIENT_GUARDIAN', patientId: p.id }, { secret: accessSecret, expiresIn: '10m' }) };
  }

  /** Client A, caregiver A: a care request, a draft booking sent for checking, a confirmed booking with an issued invoice. */
  let a: { client: Awaited<ReturnType<typeof newClient>>; cg: Awaited<ReturnType<typeof newCaregiver>>; requestId: string; draftId: string; bookingId: string; shiftId: string; invoiceId: string };
  let b: { client: Awaited<ReturnType<typeof newClient>>; cg: Awaited<ReturnType<typeof newCaregiver>> };

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
    const districtId = tree.flatMap((p) => p.districts)[1].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };

    const client = await newClient();
    const cg = await newCaregiver();
    const requestId = (await api().post('/me/care-requests').set(bearer(client.token)).send({ caregiverPublicId: cg.publicId }).expect(201)).body.id;
    const book = async () => {
      const monday = freshMonday();
      return (
        await api()
          .post('/bookings')
          .set(bearer(staffToken))
          .send({ patientId: client.patientId, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: monday, endDate: addDays(monday, 1), rateType: 'DAILY', rateAmount: '3500', clientRateAmount: '4200' })
          .expect(201)
      ).body;
    };
    const draft = await book();
    await api().post(`/bookings/${draft.id}/ask-client`).set(bearer(staffToken)).expect(200);
    const confirmed = await book();
    const booking = (await api().post(`/bookings/${confirmed.id}/confirm`).set(bearer(staffToken)).expect(200)).body;
    const inv = (
      await api()
        .post('/invoices')
        .set(bearer(staffToken))
        .send({ bookingId: booking.id, basis: 'SCHEDULED', periodStart: booking.startDate, periodEnd: booking.endDate })
        .expect(201)
    ).body;
    await api().post(`/invoices/${inv.id}/issue`).set(bearer(staffToken)).expect(200);
    a = { client, cg, requestId, draftId: draft.id, bookingId: booking.id, shiftId: booking.shifts[0].id, invoiceId: inv.id };
    b = { client: await newClient(), cg: await newCaregiver() };
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  /** Refused, and refused exactly as an id that does not exist. */
  async function refused(call: (id: string) => request.Test, id: string) {
    const theirs = await call(id);
    const none = await call(NOBODY);
    // Any refusal will do (400, 403, 404, 409), as long as it is the same one an unknown id gets.
    expect(theirs.status).toBeGreaterThanOrEqual(400);
    expect({ status: theirs.status, message: theirs.body.message }).toEqual({ status: none.status, message: none.body.message });
    return theirs;
  }

  describe('a client, on another client', () => {
    it("cannot read or pay another client's invoice", async () => {
      await refused((id) => api().get(`/me/invoices/${id}`).set(bearer(b.client.token)), a.invoiceId);
      await refused((id) => api().post(`/me/invoices/${id}/payhere`).set(bearer(b.client.token)).send({}), a.invoiceId);
      // Online payment is off here, so check the lookup Pay now uses once it is on.
      const asUser = (c: { token: string }) => jwt.verify(c.token, { secret: accessSecret }) as { sub: string; role: string; patientId: string };
      const svc = app.get(InvoicesService);
      const user = (c: { token: string }) => ({ userId: asUser(c).sub, role: 'PATIENT_GUARDIAN', patientId: asUser(c).patientId }) as never;
      await expect(svc.payableForClient(user(b.client), a.invoiceId)).rejects.toThrow('Invoice not found');
      await expect(svc.payableForClient(user(a.client), a.invoiceId)).resolves.toMatchObject({ invoice: { id: a.invoiceId } });
      expect((await api().get('/me/invoices').set(bearer(b.client.token)).expect(200)).body.items ?? []).toHaveLength(0);
      // The owner can.
      await api().get(`/me/invoices/${a.invoiceId}`).set(bearer(a.client.token)).expect(200);
    });

    it("cannot answer another client's booking proposal", async () => {
      await refused((id) => api().post(`/me/booking-proposals/${id}/accept`).set(bearer(b.client.token)), a.draftId);
      await refused((id) => api().post(`/me/booking-proposals/${id}/request-changes`).set(bearer(b.client.token)).send({ note: 'Please change the times' }), a.draftId);
      const [row] = await db.select({ clientAnswer: bookings.clientAnsweredAt, status: bookings.status }).from(bookings).where(eq(bookings.id, a.draftId));
      expect(row).toMatchObject({ status: 'DRAFT', clientAnswer: null });
    });

    it("cannot cancel or fill in another client's care request", async () => {
      await refused((id) => api().post(`/me/care-requests/${id}/cancel`).set(bearer(b.client.token)), a.requestId);
      await refused((id) => api().patch(`/me/care-requests/${id}/details`).set(bearer(b.client.token)).send({ schedule: 'NIGHT' }), a.requestId);
      const [row] = await db.select({ status: careRequests.status }).from(careRequests).where(eq(careRequests.id, a.requestId));
      expect(row.status).not.toBe('CANCELLED');
    });

    it("cannot report an issue or leave a review on another client's booking", async () => {
      await refused((id) => api().post(`/me/bookings/${id}/issues`).set(bearer(b.client.token)).send({ category: 'OTHER', message: 'Probe' }), a.bookingId);
      await refused((id) => api().put(`/me/bookings/${id}/reviews/${a.cg.publicId}`).set(bearer(b.client.token)).send({ rating: 1, badges: [] }), a.bookingId);
      await refused((id) => api().get(`/me/bookings/${id}/reviews/${a.cg.publicId}`).set(bearer(b.client.token)), a.bookingId);
    });

    it("does not see another client's bookings, requests or invoices in its own lists", async () => {
      const mine = await Promise.all(['/me/bookings', '/me/care-requests', '/me/booking-proposals', '/me/invoices'].map((p) => api().get(p).set(bearer(b.client.token))));
      for (const r of mine) {
        if (r.status === 404) continue; // a list this portal does not have
        expect(r.status).toBe(200);
        expect(JSON.stringify(r.body)).not.toContain(a.bookingId);
        expect(JSON.stringify(r.body)).not.toContain(a.requestId);
        expect(JSON.stringify(r.body)).not.toContain(a.invoiceId);
        expect(JSON.stringify(r.body)).not.toContain(a.draftId);
      }
    });
  });

  describe('a caregiver, on another caregiver', () => {
    it("cannot open the care plan of another caregiver's shift (it holds the client's details)", async () => {
      await refused((id) => api().get(`/me/shifts/${id}/care`).set(bearer(b.cg.token)), a.shiftId);
    });

    it("cannot say it can't make, report an issue on, or check in to another caregiver's shift", async () => {
      await refused((id) => api().post(`/me/shifts/${id}/cant-make`).set(bearer(b.cg.token)).send({}), a.shiftId);
      await refused((id) => api().delete(`/me/shifts/${id}/cant-make`).set(bearer(b.cg.token)), a.shiftId);
      await refused((id) => api().post(`/me/shifts/${id}/issues`).set(bearer(b.cg.token)).send({ category: 'OTHER', message: 'Probe' }), a.shiftId);
      const [row] = await db.select({ cantMakeAt: bookingShifts.cantMakeAt, caregiverId: bookingShifts.caregiverId }).from(bookingShifts).where(eq(bookingShifts.id, a.shiftId));
      expect(row.cantMakeAt).toBeNull();
      expect(row.caregiverId).toBe(a.cg.id);
    });

    it("does not see another caregiver's shifts", async () => {
      const r = await api().get('/me/shifts').set(bearer(b.cg.token)).expect(200);
      expect(JSON.stringify(r.body)).not.toContain(a.shiftId);
    });
  });

  describe('across portals', () => {
    it('a caregiver token cannot use client routes, and a client token cannot use caregiver or staff routes', async () => {
      await api().get(`/me/invoices/${a.invoiceId}`).set(bearer(a.cg.token)).expect(403);
      await api().get(`/me/shifts/${a.shiftId}/care`).set(bearer(a.client.token)).expect(403);
      await api().get(`/caregivers/${a.cg.id}`).set(bearer(a.client.token)).expect(403);
      for (const path of ['/bookings', '/invoices', '/care-requests', '/caregivers', '/patients', '/users', '/talk-requests', '/visits/today', '/automation/decisions', '/settings/ai']) {
        for (const token of [a.client.token, a.cg.token]) {
          const r = await api().get(path).set(bearer(token));
          expect({ path, status: r.status }).toEqual({ path, status: 403 });
        }
      }
    });

    it('refuses a token signed with the wrong key, an expired token, and one that claims a role the account does not have', async () => {
      const [cgRow] = await db.select({ userId: caregivers.userId }).from(caregivers).where(eq(caregivers.id, a.cg.id));
      const forged = jwt.sign({ sub: cgRow.userId, role: 'ADMIN' }, { secret: 'not-the-key', expiresIn: '10m' });
      await api().get('/bookings').set(bearer(forged)).expect(401);
      const expired = jwt.sign({ sub: cgRow.userId, role: 'CAREGIVER', caregiverId: a.cg.id, iat: Math.floor(Date.now() / 1000) - 3600 }, { secret: accessSecret, expiresIn: '1s' });
      await api().get('/me/shifts').set(bearer(expired)).expect(401);
      await api().get('/bookings').set(bearer('')).expect(401);
      await api().get('/bookings').set({ Authorization: 'Bearer none.none.none' }).expect(401);
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: cgRow.userId, role: 'ADMIN' })).toString('base64url')}.`;
      await api().get('/bookings').set(bearer(unsigned)).expect(401);
    });

    it("a validly signed token for a caregiver that claims ADMIN does not get admin access", async () => {
      // Only the server can sign; this checks the role comes from the account, not just the token,
      // which matters if a signing key ever leaks or a role is changed while a token is live.
      const [cgRow] = await db.select({ userId: caregivers.userId }).from(caregivers).where(eq(caregivers.id, a.cg.id));
      const claimed = jwt.sign({ sub: cgRow.userId, role: 'ADMIN' }, { secret: accessSecret, expiresIn: '10m' });
      const r = await api().get('/settings/ai').set(bearer(claimed));
      expect(r.status).toBe(403);
    });
  });

  it('the invoice really is the client A one, so the probes above test something', async () => {
    const [row] = await db.select({ patientId: invoices.patientId, status: invoices.status }).from(invoices).where(eq(invoices.id, a.invoiceId));
    expect(row).toEqual({ patientId: a.client.patientId, status: 'ISSUED' });
  });
});
