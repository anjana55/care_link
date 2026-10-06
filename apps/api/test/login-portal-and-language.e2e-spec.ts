import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { auditLogs, refreshTokens, users } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * Two cross-cutting behaviours, over real HTTP against the real database:
 *
 *  1. Sign-in is bound to a portal. Correct credentials for an account that
 *     belongs to another portal are answered exactly like a wrong password, issue
 *     no session, and are written to the audit log.
 *  2. Every message the API returns can be asked for in English, Sinhala or Tamil.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue(unlimitedThrottle)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

const PASSWORD = 'PortalTest-123';
const INVALID = 'Invalid credentials';

describe('Portal-bound sign-in and message language (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const api = () => request(app.getHttpServer());
  const run = Math.floor(Date.now() / 1000) % 100_000;
  const emailOf = (role: string) => `portal-${role.toLowerCase()}-${run}@example.com`;

  const accounts = {
    ADMIN: { email: 'admin@care-platform.local', password: SEED_PASSWORD },
    STAFF: { email: 'staff@care-platform.local', password: SEED_PASSWORD },
    VERIFIER: { email: 'verifier@care-platform.local', password: SEED_PASSWORD },
    CAREGIVER: { email: 'selfregistered@care-platform.local', password: SEED_PASSWORD },
    PATIENT_GUARDIAN: { email: emailOf('PATIENT_GUARDIAN'), password: PASSWORD },
  } as const;
  type Role = keyof typeof accounts;

  const login = (role: Role, portal?: string, query = '') =>
    api().post(`/auth/login${query}`).send({ ...accounts[role], ...(portal ? { portal } : {}) });
  const wrongPassword = (portal?: string, query = '') =>
    api().post(`/auth/login${query}`).send({ email: accounts.ADMIN.email, password: 'definitely-wrong-1', ...(portal ? { portal } : {}) });

  /** What a caller can observe of an error, minus the per-request timestamp and path. */
  const shape = (body: Record<string, unknown>) => ({ statusCode: body.statusCode, message: body.message, keys: Object.keys(body).sort() });

  beforeAll(async () => {
    app = await buildApp();
    db = app.get<Database>(DRIZZLE);
    await db
      .insert(users)
      .values({
        id: randomUUID(),
        email: accounts.PATIENT_GUARDIAN.email,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        fullName: 'Portal Test Client',
        role: 'PATIENT_GUARDIAN',
        isActive: true,
        emailVerifiedAt: new Date(),
      })
      .onDuplicateKeyUpdate({ set: { fullName: 'Portal Test Client' } });
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, accounts.PATIENT_GUARDIAN.email));
    await db.delete(users).where(eq(users.email, `portal-unverified-${run}@example.com`));
    await app.close();
  });

  // ---------------------------------------------------------------------------
  describe('password sign-in by portal', () => {
    const ALLOWED: Record<Role, string> = {
      ADMIN: 'staff',
      STAFF: 'staff',
      VERIFIER: 'staff',
      CAREGIVER: 'caregiver',
      PATIENT_GUARDIAN: 'customer',
    };
    const PORTALS = ['staff', 'caregiver', 'customer'];
    const matrix = (Object.keys(ALLOWED) as Role[]).flatMap((role) => PORTALS.map((portal) => [role, portal, ALLOWED[role] === portal] as const));

    it.each(matrix)('%s on the %s portal -> allowed: %s', async (role, portal, allowed) => {
      const res = await login(role, portal);
      if (allowed) {
        expect(res.status).toBe(201);
        expect(res.body.accessToken).toBeDefined();
      } else {
        expect(res.status).toBe(401);
        expect(res.body.accessToken).toBeUndefined();
        expect(res.body.message).toBe(INVALID);
      }
    });

    it('answers a refused portal exactly like a wrong password', async () => {
      const wrong = await wrongPassword('caregiver');
      for (const [role, portal] of [['ADMIN', 'caregiver'], ['STAFF', 'customer'], ['CAREGIVER', 'staff'], ['PATIENT_GUARDIAN', 'caregiver']] as const) {
        const refused = await login(role, portal);
        expect(shape(refused.body)).toEqual(shape(wrong.body));
        expect(refused.status).toBe(wrong.status);
      }
    });

    it('issues no session for a refused attempt', async () => {
      const [admin] = await db.select().from(users).where(eq(users.email, accounts.ADMIN.email));
      const count = async () => (await db.select().from(refreshTokens).where(eq(refreshTokens.userId, admin.id))).length;
      const before = await count();

      await login('ADMIN', 'caregiver').expect(401);
      await login('ADMIN', 'customer').expect(401);

      expect(await count()).toBe(before);
    });

    it('writes the refused attempt to the audit log, but not an ordinary wrong password', async () => {
      const [staff] = await db.select().from(users).where(eq(users.email, accounts.STAFF.email));
      const wrongPortalEvents = async () =>
        (await db.select().from(auditLogs).where(and(eq(auditLogs.userId, staff.id), eq(auditLogs.action, 'LOGIN_WRONG_PORTAL')))).length;
      const before = await wrongPortalEvents();

      await login('STAFF', 'customer').expect(401);
      await api().post('/auth/login').send({ email: accounts.STAFF.email, password: 'wrong-password-1', portal: 'customer' }).expect(401);

      expect(await wrongPortalEvents()).toBe(before + 1);
    });

    it('never reveals "verify your email" for an account that belongs to another portal', async () => {
      const email = `portal-unverified-${run}@example.com`;
      await db.insert(users).values({
        id: randomUUID(), email, passwordHash: await bcrypt.hash(PASSWORD, 10), fullName: 'Unverified Caregiver',
        role: 'CAREGIVER', isActive: true, emailVerifiedAt: null,
      });
      const credentials = { email, password: PASSWORD };

      // On its own portal the account says what it needs...
      const own = await api().post('/auth/login').send({ ...credentials, portal: 'caregiver' }).expect(401);
      expect(own.body.message).toMatch(/verify your email/i);
      // ...on any other it is simply "invalid credentials", as if it did not exist.
      for (const portal of ['customer', 'staff']) {
        const other = await api().post('/auth/login').send({ ...credentials, portal }).expect(401);
        expect(other.body.message).toBe(INVALID);
      }
    });

    it('still signs everyone in when the client does not say which portal (older clients)', async () => {
      for (const role of Object.keys(accounts) as Role[]) {
        const res = await login(role);
        expect({ role, status: res.status }).toEqual({ role, status: 201 });
      }
    });

    it('rejects a portal it does not know', async () => {
      await login('ADMIN', 'everywhere').expect(400);
    });
  });

  describe('when the server requires a portal (AUTH_REQUIRE_LOGIN_PORTAL=true)', () => {
    let strict: INestApplication;
    beforeAll(async () => {
      process.env.AUTH_REQUIRE_LOGIN_PORTAL = 'true';
      strict = await buildApp();
    });
    afterAll(async () => {
      delete process.env.AUTH_REQUIRE_LOGIN_PORTAL;
      await strict.close();
    });

    it('refuses a sign-in that does not name its portal, before looking at the password', async () => {
      const noPortal = await request(strict.getHttpServer()).post('/auth/login').send(accounts.ADMIN).expect(400);
      expect(noPortal.body.message).toBe('portal is required');
      // Same answer whether or not the credentials are good.
      const bad = await request(strict.getHttpServer()).post('/auth/login').send({ email: accounts.ADMIN.email, password: 'wrong-pass-1' }).expect(400);
      expect(bad.body.message).toBe('portal is required');
    });

    it('signs in normally when the portal is named', async () => {
      await request(strict.getHttpServer()).post('/auth/login').send({ ...accounts.ADMIN, portal: 'staff' }).expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe('WhatsApp sign-in by portal', () => {
    let caregiverPhone: string;
    let intake: Record<string, unknown>;
    const e164 = (p: string) => `+94${p.replace(/^0/, '')}`;
    let counter = 0;
    const newPhone = () => `076${String((run % 1000) * 10_000 + ++counter + 5000).padStart(7, '0')}`;
    let adminToken: string;

    const requestOtp = (phone: string, portal?: string) =>
      api().post('/auth/whatsapp/request-otp').send({ phone, purpose: 'LOGIN', ...(portal ? { portal } : {}) });
    const verifyOtp = (phone: string, code: string, portal?: string) =>
      api().post('/auth/whatsapp/verify-otp').send({ phone, purpose: 'LOGIN', code, ...(portal ? { portal } : {}) });
    const clearOtps = (phone: string) => db.execute(sql`DELETE FROM whatsapp_otps WHERE phone = ${e164(phone)}`);

    beforeAll(async () => {
      adminToken = (await login('ADMIN')).body.accessToken;
      await api().patch('/settings/whatsapp').set({ Authorization: `Bearer ${adminToken}` }).send({
        enabled: true, provider: 'CONSOLE', caregiverEnabled: true, customerEnabled: true, registrationEnabled: true,
        loginEnabled: true, recoveryEnabled: true, otpLength: 6, otpTtlSeconds: 300, otpMaxAttempts: 5,
        otpResendCooldownSeconds: 15, otpMaxSendsPerHour: 20, defaultCountryCode: '94',
      }).expect(200);

      const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
      const districtId = tree.flatMap((p) => p.districts)[0].id;
      const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
      intake = {
        registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78,
        recipientGender: 'MALE', preferredContactMethod: 'PHONE_CALL', districtId, cityId,
        careNeeds: 'Needs help with bathing, meals and medication reminders.', careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
      };

      caregiverPhone = newPhone();
      const reg = await api().post('/auth/whatsapp/register-caregiver').send({
        whatsappNumber: caregiverPhone, consentAccepted: true, fullName: 'WA Portal Caregiver', permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1992-06-15', gender: 'FEMALE', civilStatus: 'SINGLE', emergencyContactName: 'EC Person',
        emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Sister',
      }).expect(201);
      await api().post('/auth/whatsapp/verify-otp').send({ phone: caregiverPhone, purpose: 'REGISTER', code: reg.body.devOtp }).expect(201);
    });

    it('sends a caregiver\'s number a code on the caregiver portal, and says nothing on the client portal', async () => {
      await clearOtps(caregiverPhone);
      const wrongPortal = await requestOtp(caregiverPhone, 'customer').expect(201);
      expect(wrongPortal.body.devOtp).toBeUndefined();

      const rightPortal = await requestOtp(caregiverPhone, 'caregiver').expect(201);
      expect(rightPortal.body.devOtp).toMatch(/^\d{6}$/);
      // Identical apart from the dev-only code, so the screen cannot tell the difference.
      const { devOtp: _ignored, ...visible } = rightPortal.body;
      expect(visible).toEqual(wrongPortal.body);
    });

    it('will not sign a caregiver in through the client portal, even with a genuine code', async () => {
      await clearOtps(caregiverPhone);
      const code = (await requestOtp(caregiverPhone, 'caregiver').expect(201)).body.devOtp as string;

      const refused = await verifyOtp(caregiverPhone, code, 'customer').expect(401);
      expect(refused.body.accessToken).toBeUndefined();
      expect(refused.body.tokens).toBeUndefined();
      // Indistinguishable from a wrong code.
      const wrong = await verifyOtp(caregiverPhone, code === '000000' ? '111111' : '000000', 'customer').expect(401);
      expect(wrong.body.message).toBe(refused.body.message);

      // The code is single-use, so that attempt spent it; a fresh one on the right portal works.
      await clearOtps(caregiverPhone);
      const fresh = (await requestOtp(caregiverPhone, 'caregiver').expect(201)).body.devOtp as string;
      const accepted = await verifyOtp(caregiverPhone, fresh, 'caregiver').expect(201);
      expect(accepted.body.accessToken ?? accepted.body.tokens?.accessToken).toBeDefined();
    });

    it('treats a client\'s number the same way on the caregiver portal', async () => {
      const phone = newPhone();
      const reg = await api().post('/auth/whatsapp/register-patient').send({ whatsappNumber: phone, consentAccepted: true, fullName: 'WA Portal Client', ...intake }).expect(201);
      await api().post('/auth/whatsapp/verify-otp').send({ phone, purpose: 'REGISTER', code: reg.body.devOtp }).expect(201);

      await clearOtps(phone);
      expect((await requestOtp(phone, 'caregiver').expect(201)).body.devOtp).toBeUndefined();
      expect((await requestOtp(phone, 'customer').expect(201)).body.devOtp).toMatch(/^\d{6}$/);
    });

    it('still works for a client that does not say which portal', async () => {
      await clearOtps(caregiverPhone);
      expect((await requestOtp(caregiverPhone).expect(201)).body.devOtp).toMatch(/^\d{6}$/);
    });

    it('rejects a portal WhatsApp does not serve', async () => {
      await requestOtp(caregiverPhone, 'staff').expect(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('message language', () => {
    const SI_INVALID = 'පිවිසුම් අක්තපත්‍ර වලංගු නැත';
    const TA_INVALID = 'உள்நுழைவுச் சான்றுகள் தவறானவை';

    it('answers in English by default', async () => {
      const res = await wrongPassword('staff').expect(401);
      expect(res.body.message).toBe(INVALID);
      expect(res.headers['content-language']).toBe('en');
    });

    it('answers in the language asked for with lang', async () => {
      expect((await wrongPassword('staff', '?lang=si').expect(401)).body.message).toBe(SI_INVALID);
      expect((await wrongPassword('staff', '?lang=ta').expect(401)).body.message).toBe(TA_INVALID);
    });

    it('answers in the language of Accept-Language, honouring preference order', async () => {
      const ask = (header: string) =>
        api().post('/auth/login').set('Accept-Language', header).send({ email: accounts.ADMIN.email, password: 'definitely-wrong-1', portal: 'staff' });
      expect((await ask('si-LK,si;q=0.9,en;q=0.8')).body.message).toBe(SI_INVALID);
      expect((await ask('en;q=0.3,ta;q=0.9')).body.message).toBe(TA_INVALID);
      expect((await ask('fr,de;q=0.9')).body.message).toBe(INVALID);
    });

    it('lets lang win over Accept-Language', async () => {
      const res = await api().post('/auth/login?lang=si').set('Accept-Language', 'ta').send({ email: accounts.ADMIN.email, password: 'definitely-wrong-1', portal: 'staff' });
      expect(res.body.message).toBe(SI_INVALID);
    });

    it('says which language it chose, and varies on the header', async () => {
      const si = await wrongPassword('staff', '?lang=si');
      expect(si.headers['content-language']).toBe('si');
      expect(si.headers.vary).toMatch(/Accept-Language/i);
      // An unsupported language is not an error; it falls back and says so.
      const fr = await wrongPassword('staff', '?lang=fr').expect(401);
      expect(fr.headers['content-language']).toBe('en');
      expect(fr.body.message).toBe(INVALID);
    });

    it('translates a wrong-portal refusal the same way as a wrong password', async () => {
      const refused = await login('ADMIN', 'caregiver', '?lang=si').expect(401);
      const wrong = await wrongPassword('caregiver', '?lang=si').expect(401);
      expect(refused.body.message).toBe(SI_INVALID);
      expect(shape(refused.body)).toEqual(shape(wrong.body));
    });

    it('translates validation errors, one per problem', async () => {
      const res = await api().post('/auth/login?lang=si').send({ email: 'not-an-email', password: 'short', portal: 'staff' }).expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining(['email වලංගු විද්‍යුත් ලිපිනයක් විය යුතුය', 'password අක්ෂර 8ක් හෝ ඊට වැඩි විය යුතුය']),
      );
      const en = await api().post('/auth/login').send({ email: 'not-an-email', password: 'short', portal: 'staff' }).expect(400);
      expect(en.body.message).toEqual(expect.arrayContaining(['email must be an email']));
    });

    it('translates messages thrown by services', async () => {
      const token = (await login('ADMIN', 'staff')).body.accessToken;
      const res = await api().get(`/caregivers/${randomUUID()}?lang=ta`).set({ Authorization: `Bearer ${token}` }).expect(404);
      expect(res.body.message).toBe('பராமரிப்பாளர் கிடைக்கவில்லை');
    });

    it('translates messages thrown by guards', async () => {
      const token = (await login('STAFF', 'staff')).body.accessToken;
      const res = await api().get('/settings/social-auth?lang=si').set({ Authorization: `Bearer ${token}` }).expect(403);
      expect(res.body.message).toBe('මෙම ක්‍රියාව සිදු කිරීමට ඔබට අවසරයක් නැත');
    });

    it('translates the framework\'s own errors', async () => {
      const res = await api().get('/caregivers?lang=ta').expect(401);
      expect(res.body.message).toBe('அங்கீகரிக்கப்படவில்லை');
    });

    it('translates the message in a success response', async () => {
      const res = await api().post('/auth/resend-verification?lang=si').send({ email: `nobody-${run}@example.com` });
      expect(res.body.message).toBe('මෙම විද්‍යුත් ලිපිනය සහිත ගිණුමක් තිබී තවම තහවුරු කර නොමැති නම්, නව තහවුරු කිරීමේ සබැඳියක් යවා ඇත.');
    });

    it('leaves data in a success response alone', async () => {
      const token = (await login('ADMIN', 'staff')).body.accessToken;
      const plain = await api().get('/skills').set({ Authorization: `Bearer ${token}` }).expect(200);
      const si = await api().get('/skills?lang=si').set({ Authorization: `Bearer ${token}` }).expect(200);
      expect(si.body).toEqual(plain.body);
    });
  });
});
