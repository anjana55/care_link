import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID as uuid } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import {
  accountDeletionRequests,
  caregiverDocuments,
  caregiverSkills,
  caregivers,
  careRequests,
  deviceTokens,
  patients,
  payoutStatements,
  refreshTokens,
  savedCaregivers,
  skills,
  users,
} from '../src/database/schema';
import { AccountDeletionService } from '../src/account-deletion/account-deletion.service';
import { STORAGE_SERVICE, type StorageService } from '../src/storage/storage.interface';
import { SEED_PASSWORD } from './seed-password';

/**
 * "Delete my account", over real HTTP against the real database: the request
 * locks the account at once, staff see it with what's still open and can
 * cancel it, and 14 days on - once nothing is open - the person is erased
 * while their bookings, invoices and payouts keep their references.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const DAY = 24 * 60 * 60 * 1000;
// The smallest file the document upload accepts: a PNG's signature and a little more.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

describe('Account deletion (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let verifierToken: string;
  let deletion: AccountDeletionService;
  let storage: StorageService;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `072${String(run * 1000 + ++n).padStart(7, '0')}`;
  const newNic = () => `19${String(run * 10_000 + ++n).padStart(10, '0')}`;

  async function newClient() {
    const email = `deletion-client-${run}-${++n}@example.com`;
    const password = 'SelfRegPass123';
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email, password, fullName: 'Kamala Perera', phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, row.userId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, userId: row.userId, email, password, token };
  }

  async function newCaregiver(status = 'ACTIVE') {
    const phone = newPhone();
    const nic = newNic();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
        nic,
        consentAccepted: true,
        fullName: `Nimali Silva ${phone}`,
        permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1990-03-10',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        emergencyContactName: 'Sunil Silva',
        emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Brother',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = ${status} WHERE id = ${row.id}`);
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, publicId: row.publicId, userId: row.userId!, registrationNumber: row.registrationNumber, phone, nic, token };
  }

  const ask = (token: string) => api().post('/me/account/deletion').set(bearer(token));
  const queue = async () => (await api().get('/account-deletions').set(bearer(staffToken)).expect(200)).body as { id: string; caregiverId: string | null; patientId: string | null; [k: string]: unknown }[];
  const requestOf = async (userId: string) => (await db.select().from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)))[0];

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
    deletion = app.get(AccountDeletionService);
    storage = app.get<StorageService>(STORAGE_SERVICE);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;

    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    verifierToken = (await login('verifier@care-platform.local')).body.accessToken;
    expect(staffToken && verifierToken).toBeTruthy();

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

  describe('asking', () => {
    it('locks a client account at once: signed out, no sign-in, no push', async () => {
      const client = await newClient();
      await db.insert(deviceTokens).values({ id: uuid(), userId: client.userId, expoPushToken: `ExponentPushToken[${uuid()}]`, platform: 'android' });
      const signedIn = await api().post('/auth/login').send({ email: client.email, password: client.password, portal: 'customer' }).expect(201);

      const before = Date.now();
      const res = await ask(client.token).expect(200);
      const eraseAfter = new Date(res.body.eraseAfter).getTime();
      expect(eraseAfter - before).toBeGreaterThanOrEqual(14 * DAY - 5_000);
      expect(eraseAfter - before).toBeLessThan(14 * DAY + 60_000);

      // Every session is ended at once, before anyone tries to use one.
      const sessions = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, client.userId));
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((t) => t.revoked)).toBe(true);
      // Every token stops working, the refresh token included.
      await api().get('/me/saved-caregivers').set(bearer(client.token)).expect(401);
      await api().post('/auth/refresh').send({ refreshToken: signedIn.body.refreshToken }).expect(401);
      await api().post('/auth/login').send({ email: client.email, password: client.password, portal: 'customer' }).expect(401);
      const [device] = await db.select().from(deviceTokens).where(eq(deviceTokens.userId, client.userId));
      expect(device.revokedAt).not.toBeNull();
      const [p] = await db.select().from(patients).where(eq(patients.id, client.patientId));
      expect(p.status).toBe('INACTIVE');
      // Nothing is erased yet.
      expect(p.fullName).toBe('Kamala Perera');
    });

    it('takes a caregiver out of search', async () => {
      const cg = await newCaregiver('ACTIVE');
      await api().get(`/public/caregivers/${cg.publicId}`).expect(200);
      await ask(cg.token).expect(200);
      await api().get(`/public/caregivers/${cg.publicId}`).expect(404);
      expect((await requestOf(cg.userId)).previousStatus).toBe('ACTIVE');
    });

    it('is only for caregiver and client accounts', async () => {
      await ask(staffToken).expect(403);
      await api().post('/me/account/deletion').expect(401);
    });
  });

  describe('staff', () => {
    it('see each request with who it is and what is still open; verifiers do not', async () => {
      const cg = await newCaregiver();
      await db.insert(payoutStatements).values({ id: uuid(), reference: `PO-T${run}${++n}`.slice(0, 16), caregiverId: cg.id, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'APPROVED' } as never);
      await ask(cg.token).expect(200);

      const row = (await queue()).find((r) => r.caregiverId === cg.id)!;
      expect(row).toMatchObject({ role: 'CAREGIVER', status: 'PENDING', reference: cg.registrationNumber, erasedAt: null });
      expect(row.name).toMatch(/^Nimali Silva/);
      expect(row.openItems).toMatchObject({ unpaidPayouts: 1, upcomingShifts: 0, activeBookings: 0 });

      await api().get('/account-deletions').set(bearer(verifierToken)).expect(403);
      await api().post(`/account-deletions/${row.id}/cancel`).set(bearer(verifierToken)).expect(403);
    });

    it('can cancel within the grace period, which puts the account back as it was', async () => {
      const cg = await newCaregiver('VERIFIED');
      await ask(cg.token).expect(200);
      const row = (await queue()).find((r) => r.caregiverId === cg.id)!;

      await api().post(`/account-deletions/${row.id}/cancel`).set(bearer(staffToken)).expect(200);
      const [c] = await db.select().from(caregivers).where(eq(caregivers.id, cg.id));
      expect(c.status).toBe('VERIFIED');
      const [u] = await db.select().from(users).where(eq(users.id, cg.userId));
      expect(u.isActive).toBe(true);
      expect((await requestOf(cg.userId)).status).toBe('CANCELLED');
      // Signed in again, the same token works.
      await api().get(`/caregivers/${cg.id}`).set(bearer(cg.token)).expect(200);

      await api().post(`/account-deletions/${row.id}/cancel`).set(bearer(staffToken)).expect(409);
      // Nothing to erase once cancelled.
      expect(await deletion.eraseDue(new Date(Date.now() + 30 * DAY))).toBeGreaterThanOrEqual(0);
      expect((await requestOf(cg.userId)).status).toBe('CANCELLED');
    });
  });

  describe('erasure', () => {
    it('waits out the grace period, then for whatever is still open, then erases the client', async () => {
      const client = await newClient();
      const cg = await newCaregiver();
      await api().put(`/me/saved-caregivers/${cg.publicId}`).set(bearer(client.token)).expect(200);
      await db.insert(deviceTokens).values({ id: uuid(), userId: client.userId, expoPushToken: `ExponentPushToken[${uuid()}]`, platform: 'ios' });
      const req = await api().post('/me/care-requests').set(bearer(client.token)).send({ caregiverPublicId: cg.publicId, message: 'Mornings, please - Dad is at 5 Lake Road' }).expect(201);
      await ask(client.token).expect(200);

      // Not before 14 days.
      await deletion.eraseDue(new Date(Date.now() + 13 * DAY));
      expect((await requestOf(client.userId)).status).toBe('PENDING');

      // After 14 days, still not while the care request is open.
      await deletion.eraseDue(new Date(Date.now() + 15 * DAY));
      expect((await requestOf(client.userId)).status).toBe('PENDING');
      expect((await queue()).find((r) => r.patientId === client.patientId)!.openItems).toMatchObject({ openCareRequests: 1 });

      // Staff close it: now it goes.
      await db.update(careRequests).set({ status: 'CLOSED' }).where(eq(careRequests.id, req.body.id));
      await deletion.eraseDue(new Date(Date.now() + 15 * DAY));
      const r = await requestOf(client.userId);
      expect(r.status).toBe('ERASED');
      expect(r.erasedAt).not.toBeNull();

      const [p] = await db.select().from(patients).where(eq(patients.id, client.patientId));
      expect(p).toMatchObject({
        fullName: 'Deleted client',
        phone: null,
        permanentAddress: null,
        nic: null,
        recipientName: null,
        careNeeds: null,
        careAddress: null,
        cityId: null,
        status: 'INACTIVE',
      });
      const [u] = await db.select().from(users).where(eq(users.id, client.userId));
      expect(u).toMatchObject({ fullName: 'Deleted account', email: null, phone: null, passwordHash: null, isActive: false });
      expect(await db.select().from(savedCaregivers).where(eq(savedCaregivers.patientId, client.patientId))).toHaveLength(0);
      expect(await db.select().from(deviceTokens).where(eq(deviceTokens.userId, client.userId))).toHaveLength(0);
      // The care request stays (staff's record), without what the client wrote.
      const [cr] = await db.select().from(careRequests).where(eq(careRequests.id, req.body.id));
      expect(cr.message).toBeNull();
      // The queue no longer names them.
      expect((await queue()).find((x) => x.patientId === client.patientId)).toMatchObject({ status: 'ERASED', name: null, reference: null, openItems: null });
      // The email address is free to register again.
      await api()
        .post('/auth/register-patient')
        .send({ email: client.email, password: 'AnotherPass123', fullName: 'Kamala Perera', phone: newPhone(), consentAccepted: true, ...intake })
        .expect(201);
    });

    it("erases a caregiver's details, documents and files, and frees their NIC and phone", async () => {
      const cg = await newCaregiver();
      const upload = await api()
        .post(`/caregivers/${cg.id}/documents`)
        .set(bearer(cg.token))
        .field('documentType', 'NIC')
        .attach('file', PNG, { filename: 'nic.png', contentType: 'image/png' });
      expect([upload.status, upload.body.message]).toEqual([201, undefined]);
      const [doc] = await db.select().from(caregiverDocuments).where(eq(caregiverDocuments.id, upload.body.id));
      await expect(storage.download(doc.storageKey)).resolves.toBeTruthy();
      const [skill] = await db.select().from(skills).limit(1);
      if (skill) await api().post(`/caregivers/${cg.id}/skills`).set(bearer(cg.token)).send({ skillId: skill.id }).expect(201);

      await ask(cg.token).expect(200);
      // Nothing is open, but the 14 days aren't up.
      await deletion.eraseDue(new Date(Date.now() + 13 * DAY));
      expect((await requestOf(cg.userId)).status).toBe('PENDING');
      expect(await db.select().from(caregiverDocuments).where(eq(caregiverDocuments.caregiverId, cg.id))).toHaveLength(1);

      await deletion.eraseDue(new Date(Date.now() + 15 * DAY));
      expect((await requestOf(cg.userId)).status).toBe('ERASED');

      const [c] = await db.select().from(caregivers).where(eq(caregivers.id, cg.id));
      expect(c).toMatchObject({
        fullName: 'Deleted caregiver',
        permanentAddress: '',
        nic: null,
        passportNumber: null,
        primaryPhone: '',
        emergencyContactName: '',
        emergencyContactNumber: '',
        status: 'INACTIVE',
        liveNic: null,
        livePrimaryPhone: null,
      });
      expect(c.deletedAt).not.toBeNull();
      // Kept, for bookings and payouts that point at it.
      expect(c.registrationNumber).toBe(cg.registrationNumber);
      expect(await db.select().from(caregiverDocuments).where(eq(caregiverDocuments.caregiverId, cg.id))).toHaveLength(0);
      expect(await db.select().from(caregiverSkills).where(eq(caregiverSkills.caregiverId, cg.id))).toHaveLength(0);
      await expect(storage.download(doc.storageKey)).rejects.toBeTruthy();

      // The same person can register again with their NIC and phone.
      await api()
        .post('/auth/register-caregiver/unified')
        .send({
          phone: cg.phone,
          nic: cg.nic,
          consentAccepted: true,
          fullName: 'Nimali Silva',
          permanentAddress: '12 Temple Road, Colombo',
          dateOfBirth: '1990-03-10',
          gender: 'FEMALE',
          civilStatus: 'SINGLE',
          emergencyContactName: 'Sunil Silva',
          emergencyContactNumber: '0770001111',
          emergencyContactRelationship: 'Brother',
        })
        .expect(201);
    });

    it('holds a caregiver with an unpaid payout until it is paid', async () => {
      const cg = await newCaregiver();
      const payoutId = uuid();
      await db.insert(payoutStatements).values({ id: payoutId, reference: `PO-H${run}${++n}`.slice(0, 16), caregiverId: cg.id, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'DRAFT' } as never);
      await ask(cg.token).expect(200);
      await deletion.eraseDue(new Date(Date.now() + 15 * DAY));
      expect((await requestOf(cg.userId)).status).toBe('PENDING');
      await db.update(payoutStatements).set({ status: 'PAID' } as never).where(eq(payoutStatements.id, payoutId));
      await deletion.eraseDue(new Date(Date.now() + 15 * DAY));
      expect((await requestOf(cg.userId)).status).toBe('ERASED');
      // The payout keeps pointing at the caregiver's (erased) record.
      const [po] = await db.select().from(payoutStatements).where(eq(payoutStatements.id, payoutId));
      expect(po.caregiverId).toBe(cg.id);
    });
  });
});
