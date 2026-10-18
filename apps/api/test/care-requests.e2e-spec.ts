import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, careRequests, patients } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * "Contact this caregiver" and "Save this caregiver", over real HTTP against
 * the real database: what a signed-in client can do, what the staff Requests
 * queue sees and does with it, and - as much as the happy path - what the
 * client must never learn about the caregiver.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

interface Caregiver {
  id: string;
  publicId: string;
  fullName: string;
  phone: string;
}
interface Client {
  patientId: string;
  userId: string;
  token: string;
}

describe('Care requests and saved caregivers (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let adminToken: string;
  let staffToken: string;
  let verifierToken: string;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `071${String(run * 1000 + ++n).padStart(7, '0')}`;

  async function newCaregiver(status = 'ACTIVE'): Promise<Caregiver> {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
        consentAccepted: true,
        fullName: `Requested Caregiver ${phone}`,
        permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1990-03-10',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        emergencyContactName: 'EC Person',
        emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Sister',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = ${status} WHERE id = ${row.id}`);
    return { id: row.id, publicId: row.publicId, fullName: row.fullName, phone: row.primaryPhone };
  }

  async function newClient(): Promise<Client> {
    const reg = await api()
      .post('/auth/register-patient')
      .send({
        email: `care-request-client-${run}-${++n}@example.com`,
        password: 'SelfRegPass123',
        fullName: 'Request Client',
        phone: newPhone(),
        consentAccepted: true,
        ...intake,
      })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    // A session as the client would hold it - signed directly because the
    // sign-in routes have their own suites.
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, userId: row.userId, token };
  }

  const send = (c: Client, caregiverPublicId: string, extra: Record<string, unknown> = {}) =>
    api().post('/me/care-requests').set(bearer(c.token)).send({ caregiverPublicId, ...extra });
  const move = (id: string, body: Record<string, unknown>, token = staffToken) =>
    api().patch(`/care-requests/${id}/status`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;

    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    verifierToken = (await login('verifier@care-platform.local')).body.accessToken;
    expect(adminToken && staffToken && verifierToken).toBeTruthy();

    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78,
      recipientGender: 'MALE', preferredContactMethod: 'PHONE_CALL', districtId, cityId,
      careNeeds: 'Needs help with bathing, meals and medication reminders.', careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sending a request', () => {
    it("creates it with a readable reference and never shows the caregiver's identity", async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const res = await send(client, cg.publicId, { message: 'Mornings preferred', status: 'INTRODUCED', patientId: 'x' }).expect(201);

      expect(res.body.reference).toMatch(/^CR-[2-9A-HJKMNP-TV-Z]{6}$/);
      expect(res.body.status).toBe('NEW'); // a status in the body is stripped, not honoured
      expect(res.body.caregiverPublicId).toBe(cg.publicId);
      expect(res.body.caregiver.publicId).toBe(cg.publicId);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(cg.id);
      expect(raw).not.toContain(cg.fullName);
      expect(raw).not.toContain(cg.phone);
      expect(raw).not.toContain('Mornings preferred'); // the message is for staff only
    });

    it('records the language the client was using, for their updates', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const res = await send(client, cg.publicId).set('Accept-Language', 'si').expect(201);
      const [row] = await db.select().from(careRequests).where(eq(careRequests.id, res.body.id));
      expect(row.language).toBe('si');
    });

    it('allows only one open request per caregiver, and a new one after cancelling', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const first = await send(client, cg.publicId).expect(201);

      const dup = await send(client, cg.publicId).set('Accept-Language', 'si').expect(409);
      expect(dup.body.message).toBe('මෙම රැකවරණ සේවකයා සඳහා ඔබට දැනටමත් විවෘත ඉල්ලීමක් ඇත');

      // Two at once (a double click) still produce exactly one.
      const cg2 = await newCaregiver();
      const results = await Promise.all([send(client, cg2.publicId), send(client, cg2.publicId), send(client, cg2.publicId)]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);

      await api().post(`/me/care-requests/${first.body.id}/cancel`).set(bearer(client.token)).expect(200);
      await send(client, cg.publicId).expect(201);
    });

    it('refuses caregivers who are not publicly listed, with the same answer as an unknown one', async () => {
      const client = await newClient();
      const hidden = await newCaregiver('REGISTERED');
      const a = await send(client, hidden.publicId).expect(404);
      const b = await send(client, '00000000-0000-4000-8000-000000000000').expect(404);
      expect(a.body.message).toBe(b.body.message);
      await send(client, 'not-a-uuid').expect(400);
    });

    it('lets a client still under review send requests, but not a suspended one', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      await send(client, cg.publicId).expect(201); // PENDING_REVIEW

      const other = await newClient();
      await db.execute(sql`UPDATE patients SET status = 'SUSPENDED' WHERE id = ${other.patientId}`);
      await send(other, cg.publicId).expect(403);
    });

    it('is only for clients', async () => {
      const cg = await newCaregiver();
      await api().post('/me/care-requests').set(bearer(staffToken)).send({ caregiverPublicId: cg.publicId }).expect(403);
      await api().post('/me/care-requests').send({ caregiverPublicId: cg.publicId }).expect(401);
    });

    it('rejects an over-long message', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      await send(client, cg.publicId, { message: 'x'.repeat(1001) }).expect(400);
    });
  });

  describe("a client's own requests", () => {
    it("lists only the caller's requests and will not cancel someone else's", async () => {
      const cg = await newCaregiver();
      const mine = await newClient();
      const theirs = await newClient();
      const req = await send(mine, cg.publicId).expect(201);

      const list = await api().get('/me/care-requests').set(bearer(theirs.token)).expect(200);
      expect(list.body.find((r: { id: string }) => r.id === req.body.id)).toBeUndefined();
      await api().post(`/me/care-requests/${req.body.id}/cancel`).set(bearer(theirs.token)).expect(404);

      const own = await api().get('/me/care-requests').set(bearer(mine.token)).expect(200);
      expect(own.body.map((r: { id: string }) => r.id)).toContain(req.body.id);
    });

    it('shows a caregiver who has since left the public listing as unavailable rather than leaking them', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const req = await send(client, cg.publicId).expect(201);
      await db.execute(sql`UPDATE caregivers SET status = 'SUSPENDED' WHERE id = ${cg.id}`);
      const list = await api().get('/me/care-requests').set(bearer(client.token)).expect(200);
      const row = list.body.find((r: { id: string }) => r.id === req.body.id);
      expect(row.caregiver).toBeNull();
      expect(row.status).toBe('NEW');
    });
  });

  describe('staff Requests queue', () => {
    it('is for admin and staff only', async () => {
      await api().get('/care-requests').set(bearer(verifierToken)).expect(403);
      const client = await newClient();
      await api().get('/care-requests').set(bearer(client.token)).expect(403);
      await api().get('/care-requests').set(bearer(staffToken)).expect(200);
    });

    it('shows both parties: masked in the list, in full on the request', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const req = await send(client, cg.publicId, { message: 'Please call after 5pm' }).expect(201);

      const list = await api().get(`/care-requests?search=${req.body.reference}`).set(bearer(staffToken)).expect(200);
      expect(list.body.total).toBe(1);
      const item = list.body.items[0];
      expect(item.caregiverName).toBe(cg.fullName);
      expect(item.clientPhone).toContain('*');

      const detail = await api().get(`/care-requests/${req.body.id}`).set(bearer(staffToken)).expect(200);
      expect(detail.body.message).toBe('Please call after 5pm');
      expect(detail.body.client.fullName).toBe('Request Client');
      expect(detail.body.client.careNeeds).toMatch(/bathing/);
      expect(detail.body.caregiver.registrationNumber).toBeTruthy();
      expect(detail.body.caregiver.primaryPhone).toBe(cg.phone);
      expect(detail.body.allowedNextStatuses).toEqual(['IN_PROGRESS', 'CLOSED']);
      expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED']);
      expect(detail.body).not.toHaveProperty('openPairKey');
    });

    it('filters by client and caregiver, so their records can link to their requests', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const req = await send(client, cg.publicId).expect(201);
      const byClient = await api().get(`/care-requests?patientId=${client.patientId}`).set(bearer(staffToken)).expect(200);
      expect(byClient.body.items.map((i: { id: string }) => i.id)).toEqual([req.body.id]);
      const byCaregiver = await api().get(`/care-requests?caregiverId=${cg.id}`).set(bearer(staffToken)).expect(200);
      expect(byCaregiver.body.items.map((i: { id: string }) => i.id)).toEqual([req.body.id]);
    });

    it('walks the status ladder, assigning whoever picks it up, and the client sees each step', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const { body: created } = await send(client, cg.publicId).expect(201);

      await move(created.id, { status: 'INTRODUCED' }).expect(400); // must be picked up first
      const picked = await move(created.id, { status: 'IN_PROGRESS', note: 'Calling the family now' }).expect(200);
      expect(picked.body.status).toBe('IN_PROGRESS');
      expect(picked.body.assignedTo?.fullName).toBeTruthy();

      await move(created.id, { status: 'CLOSED' }).expect(400); // a reason is required
      const closed = await move(created.id, { status: 'CLOSED', closeReason: 'CAREGIVER_UNAVAILABLE' }).expect(200);
      expect(closed.body.closeReason).toBe('CAREGIVER_UNAVAILABLE');
      expect(closed.body.closedAt).toBeTruthy();

      const reopened = await move(created.id, { status: 'IN_PROGRESS' }).expect(200);
      expect(reopened.body.closedAt).toBeNull();
      expect(reopened.body.closeReason).toBeNull();
      const introduced = await move(created.id, { status: 'INTRODUCED' }).expect(200);
      expect(introduced.body.events.map((e: { toStatus: string | null }) => e.toStatus)).toEqual([
        'NEW', 'IN_PROGRESS', 'CLOSED', 'IN_PROGRESS', 'INTRODUCED',
      ]);

      const own = await api().get('/me/care-requests').set(bearer(client.token)).expect(200);
      expect(own.body.find((r: { id: string }) => r.id === created.id).status).toBe('INTRODUCED');
      // Too late to cancel once the introduction is made; and staff can't "cancel" for the client.
      await api().post(`/me/care-requests/${created.id}/cancel`).set(bearer(client.token)).expect(400);
      await move(created.id, { status: 'CANCELLED' }).expect(400);
    });

    it('will not reopen a request when the client has opened a new one for the same caregiver', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const first = await send(client, cg.publicId).expect(201);
      await move(first.body.id, { status: 'CLOSED', closeReason: 'CLIENT_UNREACHABLE' }).expect(200);
      await send(client, cg.publicId).expect(201);
      await move(first.body.id, { status: 'IN_PROGRESS' }).expect(409);
    });

    it('keeps notes and assignment on the history', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const { body: created } = await send(client, cg.publicId).expect(201);

      await api().post(`/care-requests/${created.id}/notes`).set(bearer(staffToken)).send({ note: '   ' }).expect(400);
      await api().post(`/care-requests/${created.id}/notes`).set(bearer(staffToken)).send({ note: 'Left a voicemail' }).expect(201);

      const staff = (await api().get('/care-requests/assignable-staff').set(bearer(adminToken)).expect(200)).body as { id: string; fullName: string }[];
      expect(staff.length).toBeGreaterThan(0);
      const assigned = await api().patch(`/care-requests/${created.id}/assign`).set(bearer(adminToken)).send({ userId: staff[0].id }).expect(200);
      expect(assigned.body.assignedTo.id).toBe(staff[0].id);
      // Not to a client, or anyone outside admin/staff.
      await api().patch(`/care-requests/${created.id}/assign`).set(bearer(adminToken)).send({ userId: client.userId }).expect(400);
      const unassigned = await api().patch(`/care-requests/${created.id}/assign`).set(bearer(adminToken)).send({ userId: null }).expect(200);
      expect(unassigned.body.assignedTo).toBeNull();
      expect(unassigned.body.events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'NOTE', 'ASSIGNED', 'ASSIGNED']);

      // Staff notes never reach the client.
      const own = await api().get('/me/care-requests').set(bearer(client.token)).expect(200);
      expect(JSON.stringify(own.body)).not.toContain('voicemail');
    });

    it('counts requests per status for the sidebar badge', async () => {
      const res = await api().get('/care-requests/summary').set(bearer(staffToken)).expect(200);
      expect(res.body.byStatus).toHaveProperty('NEW');
      expect(res.body.open).toBe(res.body.byStatus.NEW + res.body.byStatus.IN_PROGRESS);
    });

    it("removes a client's requests and shortlist when the client is deleted", async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      const req = await send(client, cg.publicId).expect(201);
      await api().put(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);
      await api().delete(`/patients/${client.patientId}`).set(bearer(adminToken)).expect(200);
      await api().get(`/care-requests/${req.body.id}`).set(bearer(staffToken)).expect(404);
    });
  });

  describe('saved caregivers', () => {
    it('saves, lists, reports and removes - idempotently', async () => {
      const cg = await newCaregiver();
      const client = await newClient();
      await api().put(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);
      await api().put(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);

      const list = await api().get('/me/saved-caregivers').set(bearer(client.token)).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].caregiver.publicId).toBe(cg.publicId);
      expect(JSON.stringify(list.body)).not.toContain(cg.fullName);

      await send(client, cg.publicId).expect(201);
      const rel = await api().get(`/me/caregiver-relations?publicIds=${cg.publicId}`).set(bearer(client.token)).expect(200);
      expect(rel.body).toEqual([
        { caregiverPublicId: cg.publicId, saved: true, openRequest: expect.objectContaining({ status: 'NEW' }) },
      ]);

      await api().delete(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);
      await api().delete(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);
      expect((await api().get('/me/saved-caregivers').set(bearer(client.token)).expect(200)).body).toHaveLength(0);
    });

    it('will not save a caregiver who is not publicly listed', async () => {
      const hidden = await newCaregiver('DOCUMENTS_PENDING');
      const client = await newClient();
      await api().put(`/me/saved-caregivers/${hidden.publicId}`).set(bearer(client.token)).expect(404);
    });

    it("keeps one client's list away from another", async () => {
      const cg = await newCaregiver();
      const a = await newClient();
      const b = await newClient();
      await api().put(`/me/saved-caregivers/${cg.publicId}`).set(bearer(a.token)).expect(200);
      expect((await api().get('/me/saved-caregivers').set(bearer(b.token)).expect(200)).body).toHaveLength(0);
      const rel = await api().get(`/me/caregiver-relations?publicIds=${cg.publicId}`).set(bearer(b.token)).expect(200);
      expect(rel.body[0].saved).toBe(false);
    });
  });
});
