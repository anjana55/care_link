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
import { EmailService } from '../src/email/email.service';
import { EmailSettingsService } from '../src/email/email-settings.service';
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
  let adminToken: string;
  const mails: { to: string[]; subject: string; text: string; cta?: string }[] = [];
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
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    expect(staffToken && verifierToken && adminToken).toBeTruthy();
    // Staff alerts: a fixed list, and the email captured rather than sent.
    jest.spyOn(app.get(EmailSettingsService), 'staffAlertRecipients').mockResolvedValue(['ops@vivanti.example']);
    jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockImplementation(async (to, params) => {
      mails.push({
        to: [to].flat(),
        subject: params.subject,
        text: params.blocks.flatMap((b) => [b.heading, ...b.paragraphs]).join('\n'),
        cta: params.cta?.url,
      });
    });

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

  describe('what staff are told', () => {
    const auditOf = async (entityType: string, entityId: string) =>
      (await api().get(`/audit-logs?entityType=${entityType}&entityId=${entityId}`).set(bearer(adminToken)).expect(200)).body as {
        action: string;
        userId: string | null;
        metadata: Record<string, unknown>;
      }[];
    const pending = async () => (await api().get('/account-deletions/summary').set(bearer(staffToken)).expect(200)).body.pending as number;
    const mailAbout = (text: string) => waitFor(() => mails.find((m) => m.text.includes(text) || m.subject.includes(text)));
    async function waitFor<T>(find: () => T | undefined): Promise<T> {
      for (let i = 0; i < 50; i++) {
        const found = find();
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('not sent');
    }

    it('emails staff when a caregiver deletes their account, with what is still open', async () => {
      const cg = await newCaregiver();
      await db.insert(payoutStatements).values({ id: uuid(), reference: `PO-M${run}${++n}`.slice(0, 16), caregiverId: cg.id, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'APPROVED' } as never);
      const before = await pending();
      await ask(cg.token).expect(200);

      const mail = await mailAbout(cg.registrationNumber);
      expect(mail.to).toEqual(['ops@vivanti.example']);
      expect(mail.subject).toMatch(/^Account deleted by a caregiver: Nimali Silva/);
      expect(mail.text).toContain(`(${cg.registrationNumber}) deleted their account`);
      expect(mail.text).toContain('no longer appear in search');
      expect(mail.text).toContain('Still open, to settle before it can be erased: 1 payout not yet paid.');
      expect(mail.cta).toMatch(/\/account-deletions$/);
      expect(await pending()).toBe(before + 1);

      // Asking again (the website after the app) is the same request: no second email.
      const sent = mails.length;
      await ask(cg.token).expect(401); // already locked
      expect(mails.length).toBe(sent);
    });

    it("shows on the record's Audit tab: the request, the cancellation, the erasure", async () => {
      const cg = await newCaregiver();
      await ask(cg.token).expect(200);
      const entry = async (type: string, id: string, action: string) => (await auditOf(type, id)).find((a) => a.action === action)!;
      const requested = await entry('Caregiver', cg.id, 'REQUEST_ACCOUNT_DELETION');
      expect(requested).toMatchObject({ action: 'REQUEST_ACCOUNT_DELETION', userId: cg.userId });
      expect(requested.metadata).toMatchObject({ accountUserId: cg.userId, role: 'CAREGIVER' });

      const row = (await queue()).find((r) => r.caregiverId === cg.id)!;
      await api().post(`/account-deletions/${row.id}/cancel`).set(bearer(staffToken)).expect(200);
      const cancelled = await entry('Caregiver', cg.id, 'CANCEL_ACCOUNT_DELETION');
      expect(cancelled).toMatchObject({ action: 'CANCEL_ACCOUNT_DELETION', metadata: expect.objectContaining({ requestId: row.id, restoredStatus: 'ACTIVE' }) });
      expect(cancelled.userId).not.toBe(cg.userId);

      const client = await newClient();
      await ask(client.token).expect(200);
      expect(await entry('Patient', client.patientId, 'REQUEST_ACCOUNT_DELETION')).toMatchObject({ userId: client.userId });
      await mailAbout(client.email);
      // Two erasure runs at once (two API instances): one erases, the other records nothing.
      await Promise.all([deletion.eraseDue(new Date(Date.now() + 15 * DAY)), deletion.eraseDue(new Date(Date.now() + 15 * DAY))]);
      const actions = (await auditOf('Patient', client.patientId)).map((a) => a.action);
      expect(actions.filter((a) => a === 'ERASE_ACCOUNT')).toHaveLength(1);
      // Erasing again later finds nothing to do, and records nothing.
      await deletion.eraseDue(new Date(Date.now() + 16 * DAY));
      expect((await auditOf('Patient', client.patientId)).filter((a) => a.action === 'ERASE_ACCOUNT')).toHaveLength(1);
    });

    it("won't let staff switch the account back on except by cancelling the request", async () => {
      const cg = await newCaregiver();
      await ask(cg.token).expect(200);
      const refused = await api().patch(`/caregivers/${cg.id}/status`).set(bearer(adminToken)).send({ status: 'ACTIVE' }).expect(409);
      expect(refused.body.message).toBe('This person asked to delete their account. To restore it, cancel the request in Account deletions.');
      expect((await db.select().from(caregivers).where(eq(caregivers.id, cg.id)))[0].status).toBe('INACTIVE');

      const client = await newClient();
      await ask(client.token).expect(200);
      await api().patch(`/patients/${client.patientId}/active`).set(bearer(adminToken)).send({ isActive: true }).expect(409);
      expect((await db.select().from(users).where(eq(users.id, client.userId)))[0].isActive).toBe(false);
      await api().patch(`/patients/${client.patientId}/status`).set(bearer(staffToken)).send({ status: 'ACTIVE' }).expect(409);

      // Cancelling restores it, and the usual moves work again.
      const row = (await queue()).find((r) => r.caregiverId === cg.id)!;
      await api().post(`/account-deletions/${row.id}/cancel`).set(bearer(staffToken)).expect(200);
      await api().patch(`/caregivers/${cg.id}/status`).set(bearer(adminToken)).send({ status: 'INACTIVE' }).expect(200);
    });
  });
});
