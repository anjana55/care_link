import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { users, caregivers, patients, whatsappAuthSettings } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * End-to-end coverage for WhatsApp OTP sign-in, run against the real database
 * (same prerequisites as app.e2e-spec.ts: migrated + seeded). The CONSOLE
 * provider is used, so OTPs come back as `devOtp` rather than being sent.
 *
 * Throttling is stubbed out for the main suite (the endpoints are limited to
 * 5 requests/minute/IP and these tests deliberately make dozens); the final
 * describe block re-enables it to prove the limit is real.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

async function buildApp(opts: { throttle: boolean }): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!opts.throttle) builder = builder.overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

const decodeJwt = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

describe('WhatsApp authentication (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let http: ReturnType<typeof request>;
  let adminToken: string;
  let staffToken: string;

  // Unique, *valid* Sri Lankan mobile numbers (077 + 7 digits) per run, so reruns never collide.
  // They must be valid LK numbers: the email registration DTO validates phones with
  // @IsPhoneNumber('LK'), and arbitrary 07x digits are not always valid mobile prefixes.
  const runBase = Math.floor(Date.now() / 1000) % 10_000;
  let counter = 0;
  const newPhone = () => `077${String(runBase * 1000 + ++counter).padStart(7, '0')}`;
  const e164 = (local: string) => `+94${local.slice(1)}`;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // --- time-travel helpers (the OTP policy is in minutes; tests are not) ----
  const clearOtps = (phone: string) => db.execute(sql`DELETE FROM whatsapp_otps WHERE phone = ${e164(phone)}`);
  const expireOtps = (phone: string) =>
    db.execute(sql`UPDATE whatsapp_otps SET expires_at = NOW() - INTERVAL 1 MINUTE WHERE phone = ${e164(phone)} AND consumed_at IS NULL`);
  const userRow = async (phone: string) => (await db.select().from(users).where(eq(users.phone, e164(phone))).limit(1))[0];

  const caregiverBody = (phone: string, extra: Record<string, unknown> = {}) => ({
    whatsappNumber: phone,
    consentAccepted: true,
    fullName: `WA Caregiver ${phone}`,
    permanentAddress: '12 Temple Road, Colombo',
    dateOfBirth: '1992-06-15',
    gender: 'FEMALE',
    civilStatus: 'SINGLE',
    emergencyContactName: 'EC Person',
    emergencyContactNumber: '0770001111',
    emergencyContactRelationship: 'Sister',
    ...extra,
  });
  const patientBody = (phone: string, extra: Record<string, unknown> = {}) => ({
    whatsappNumber: phone,
    consentAccepted: true,
    fullName: `WA Customer ${phone}`,
    ...extra,
  });

  const registerCaregiver = (phone: string, extra?: Record<string, unknown>) =>
    api().post('/auth/whatsapp/register-caregiver').send(caregiverBody(phone, extra));
  const registerPatient = (phone: string, extra?: Record<string, unknown>) =>
    api().post('/auth/whatsapp/register-patient').send(patientBody(phone, extra));
  const requestOtp = (phone: string, purpose: 'REGISTER' | 'LOGIN' | 'RECOVERY') =>
    api().post('/auth/whatsapp/request-otp').send({ phone, purpose });
  const verifyOtp = (phone: string, purpose: 'REGISTER' | 'LOGIN' | 'RECOVERY', code: string) =>
    api().post('/auth/whatsapp/verify-otp').send({ phone, purpose, code });
  const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');

  /** Registers + verifies a caregiver; returns everything a test needs. */
  async function verifiedCaregiver() {
    const phone = newPhone();
    const reg = await registerCaregiver(phone).expect(201);
    const ver = await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(201);
    return { phone, caregiverId: reg.body.caregiverId as string, tokens: ver.body as { accessToken: string; refreshToken: string } };
  }
  async function verifiedPatient() {
    const phone = newPhone();
    const reg = await registerPatient(phone).expect(201);
    const ver = await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(201);
    return { phone, patientId: reg.body.patientId as string, tokens: ver.body as { accessToken: string; refreshToken: string } };
  }

  /** Requests a LOGIN code on a number that has an account, past any cooldown. */
  async function loginCode(phone: string, purpose: 'LOGIN' | 'RECOVERY' = 'LOGIN') {
    await clearOtps(phone);
    const res = await requestOtp(phone, purpose).expect(201);
    expect(res.body.devOtp).toMatch(/^\d{6}$/);
    return res.body.devOtp as string;
  }

  const setSettings = (patch: Record<string, unknown>) =>
    api().patch('/settings/whatsapp').set(bearer(adminToken)).send(patch);

  beforeAll(async () => {
    app = await buildApp({ throttle: false });
    db = app.get<Database>(DRIZZLE);
    http = request(app.getHttpServer());

    adminToken = (await http.post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    staffToken = (await http.post('/auth/login').send({ email: 'staff@care-platform.local', password: SEED_PASSWORD })).body.accessToken;

    // Known starting point for every run: dev console provider, default policy.
    await setSettings({
      enabled: true,
      provider: 'CONSOLE',
      caregiverEnabled: true,
      customerEnabled: true,
      registrationEnabled: true,
      loginEnabled: true,
      recoveryEnabled: true,
      otpLength: 6,
      otpTtlSeconds: 300,
      otpMaxAttempts: 5,
      otpResendCooldownSeconds: 15,
      otpMaxSendsPerHour: 20,
      defaultCountryCode: '94',
    }).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ------------------------------------------------------------------------
  describe('admin settings', () => {
    it('requires authentication', async () => {
      await api().get('/settings/whatsapp').expect(401);
      await api().patch('/settings/whatsapp').send({ enabled: false }).expect(401);
    });

    it('is admin-only (staff is forbidden)', async () => {
      await api().get('/settings/whatsapp').set(bearer(staffToken)).expect(403);
      await api().patch('/settings/whatsapp').set(bearer(staffToken)).send({ enabled: false }).expect(403);
      await api().post('/settings/whatsapp/test').set(bearer(staffToken)).send({ phone: '0771234567' }).expect(403);
    });

    it('never returns the access token, but reports that one is stored', async () => {
      const token = 'EAAGsecretTOKENvalue1234';
      const res = await setSettings({ accessToken: token }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(token);
      expect(res.body.accessTokenSet).toBe(true);
      expect(res.body.accessTokenHint).toBe('••••1234');
      expect(res.body).not.toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('accessTokenEncrypted');

      const get = await api().get('/settings/whatsapp').set(bearer(adminToken)).expect(200);
      expect(JSON.stringify(get.body)).not.toContain(token);
    });

    it('stores the access token encrypted at rest', async () => {
      const [row] = await db.select().from(whatsappAuthSettings).limit(1);
      expect(row.accessTokenEncrypted).toBeTruthy();
      expect(row.accessTokenEncrypted).not.toContain('EAAGsecretTOKENvalue1234');
      expect(row.accessTokenEncrypted).toMatch(/^v1:/);
    });

    it('keeps the stored token when a later update omits it, and removes it on request', async () => {
      const kept = await setSettings({ templateName: 'carelink_otp_v2' }).expect(200);
      expect(kept.body.accessTokenSet).toBe(true);
      const cleared = await setSettings({ clearAccessToken: true, templateName: 'carelink_otp' }).expect(200);
      expect(cleared.body.accessTokenSet).toBe(false);
      expect(cleared.body.accessTokenHint).toBeNull();
    });

    it('refuses to enable the Meta provider without its credentials', async () => {
      const res = await setSettings({ provider: 'META_CLOUD', enabled: true }).expect(400);
      expect(res.body.message).toMatch(/phone number ID|access token/);
      // nothing was half-applied
      const get = await api().get('/settings/whatsapp').set(bearer(adminToken)).expect(200);
      expect(get.body.provider).toBe('CONSOLE');
    });

    it('accepts a complete Meta configuration', async () => {
      await setSettings({ provider: 'META_CLOUD', phoneNumberId: '123456789012345', accessToken: 'EAAGtoken9999' }).expect(200);
      // back to the dev provider for the rest of the suite
      await setSettings({ provider: 'CONSOLE', clearAccessToken: true }).expect(200);
    });

    it('rejects OTP policy values outside the safe bounds', async () => {
      for (const bad of [
        { otpLength: 3 },
        { otpLength: 9 },
        { otpTtlSeconds: 30 },
        { otpTtlSeconds: 3600 },
        { otpMaxAttempts: 1 },
        { otpMaxAttempts: 50 },
        { otpResendCooldownSeconds: 1 },
        { otpMaxSendsPerHour: 0 },
        { defaultCountryCode: '+94' },
        { apiVersion: 'latest' },
        { templateName: 'Has Spaces' },
      ]) {
        await setSettings(bad).expect(400);
      }
    });

    it('will not switch WhatsApp on for neither role', async () => {
      await setSettings({ caregiverEnabled: false, customerEnabled: false }).expect(400);
    });

    it('can send a test message with the saved configuration', async () => {
      const res = await api().post('/settings/whatsapp/test').set(bearer(adminToken)).send({ phone: '0771234567' }).expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.provider).toBe('CONSOLE');
      await api().post('/settings/whatsapp/test').set(bearer(adminToken)).send({ phone: 'abc' }).expect(400);
    });

    it('records changes in the audit log without storing values', async () => {
      const res = await api().get('/audit-logs?entityType=WhatsappSettings&pageSize=50').set(bearer(adminToken));
      // The route may be mounted at /audit; fall back so the assertion is about content, not the path.
      const rows = res.status === 200 ? res.body : (await api().get('/audit?entityType=WhatsappSettings&pageSize=50').set(bearer(adminToken))).body;
      const list = Array.isArray(rows) ? rows : rows.items ?? [];
      expect(list.some((r: any) => r.action === 'UPDATE_WHATSAPP_SETTINGS')).toBe(true);
      expect(JSON.stringify(list)).not.toContain('EAAG');
    });
  });

  // ------------------------------------------------------------------------
  describe('public config + feature toggles', () => {
    it('exposes only what the sign-in screens need (no secrets)', async () => {
      const res = await api().get('/auth/whatsapp/config').expect(200);
      expect(res.body).toMatchObject({
        enabled: true,
        caregiver: { register: true, login: true, recovery: true },
        customer: { register: true, login: true, recovery: true },
        otpLength: 6,
      });
      expect(Object.keys(res.body).sort()).toEqual(
        ['caregiver', 'customer', 'defaultCountryCode', 'enabled', 'otpLength', 'otpTtlSeconds', 'resendCooldownSeconds'].sort(),
      );
    });

    it('is fully off when the master switch is off', async () => {
      await setSettings({ enabled: false }).expect(200);
      try {
        const cfg = await api().get('/auth/whatsapp/config').expect(200);
        expect(cfg.body.enabled).toBe(false);
        expect(cfg.body.caregiver.login).toBe(false);
        await registerCaregiver(newPhone()).expect(403);
        await registerPatient(newPhone()).expect(403);
        await requestOtp(newPhone(), 'LOGIN').expect(403);
        await verifyOtp(newPhone(), 'LOGIN', '123456').expect(403);
      } finally {
        await setSettings({ enabled: true }).expect(200);
      }
    });

    it('can be switched off per role', async () => {
      await setSettings({ customerEnabled: false }).expect(200);
      try {
        const cfg = await api().get('/auth/whatsapp/config').expect(200);
        expect(cfg.body.customer.register).toBe(false);
        expect(cfg.body.caregiver.register).toBe(true);
        await registerPatient(newPhone()).expect(403);
        await registerCaregiver(newPhone()).expect(201);
      } finally {
        await setSettings({ customerEnabled: true }).expect(200);
      }
    });

    it('lets an admin turn off new sign-ups without stranding existing users', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(phone).expect(201);
      await setSettings({ registrationEnabled: false }).expect(200);
      try {
        await registerCaregiver(newPhone()).expect(403);
        // …but the half-finished signup can still be completed.
        await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(201);
        // …and login (a separate toggle) still works.
        const code = await loginCode(phone);
        await verifyOtp(phone, 'LOGIN', code).expect(201);
      } finally {
        await setSettings({ registrationEnabled: true }).expect(200);
      }
    });

    it('can switch login and recovery off independently', async () => {
      const { phone } = await verifiedCaregiver();
      await setSettings({ loginEnabled: false }).expect(200);
      try {
        await requestOtp(phone, 'LOGIN').expect(403);
        await clearOtps(phone);
        await requestOtp(phone, 'RECOVERY').expect(201);
      } finally {
        await setSettings({ loginEnabled: true }).expect(200);
      }
      await setSettings({ recoveryEnabled: false }).expect(200);
      try {
        await requestOtp(phone, 'RECOVERY').expect(403);
      } finally {
        await setSettings({ recoveryEnabled: true }).expect(200);
      }
    });
  });

  // ------------------------------------------------------------------------
  describe('caregiver registration', () => {
    it('registers, sends a code, and creates an unverified, password-less account', async () => {
      const phone = newPhone();
      const res = await registerCaregiver(phone).expect(201);

      expect(res.body.caregiverId).toBeDefined();
      expect(res.body.registrationNumber).toMatch(/^CG-\d{4}-\d{6}$/);
      expect(res.body.otpSent).toBe(true);
      expect(res.body.devOtp).toMatch(/^\d{6}$/);
      expect(res.body.accessToken).toBeUndefined(); // no session until the number is verified
      expect(res.body.phone).not.toContain(phone.slice(3, 8)); // masked
      expect(res.body.userId).toBeUndefined();

      const user = await userRow(phone);
      expect(user).toMatchObject({ email: null, passwordHash: null, role: 'CAREGIVER', phoneVerifiedAt: null, isActive: true });
      expect(user.phone).toBe(e164(phone));
    });

    it('creates the caregiver profile exactly as email registration does', async () => {
      const phone = newPhone();
      const res = await registerCaregiver(phone).expect(201);
      const [profile] = await db.select().from(caregivers).where(eq(caregivers.id, res.body.caregiverId)).limit(1);
      expect(profile.status).toBe('DRAFT');
      expect(profile.consentAcceptedAt).not.toBeNull();
      expect(profile.primaryPhone).toBe(e164(phone)); // defaults to the WhatsApp number
      expect(profile.userId).toBe((await userRow(phone)).id);

      // visible to staff immediately, like any other self-registration
      const list = await api().get(`/caregivers?search=${encodeURIComponent(profile.fullName)}`).set(bearer(adminToken)).expect(200);
      expect(list.body.items.some((c: any) => c.id === profile.id)).toBe(true);
    });

    it('keeps an explicitly supplied primary phone', async () => {
      const phone = newPhone();
      const other = `0112${String(runBase).padStart(4, '0')}${String(counter).padStart(2, '0')}`;
      const res = await registerCaregiver(phone, { primaryPhone: other }).expect(201);
      const [profile] = await db.select().from(caregivers).where(eq(caregivers.id, res.body.caregiverId)).limit(1);
      expect(profile.primaryPhone).toBe(other);
    });

    it('validates input', async () => {
      await registerCaregiver('', {}).expect(400);
      await registerCaregiver('not-a-number').expect(400);
      await registerCaregiver('0771').expect(400);
      await registerCaregiver(newPhone(), { consentAccepted: false }).expect(400);
      await registerCaregiver(newPhone(), { fullName: '' }).expect(400);
      await registerCaregiver(newPhone(), { dateOfBirth: undefined }).expect(400);
    });

    it('cannot sign in before the number is verified', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(phone).expect(201);
      // LOGIN is not offered to an unverified number…
      await clearOtps(phone);
      const res = await requestOtp(phone, 'LOGIN').expect(201);
      expect(res.body.devOtp).toBeUndefined();
      // …and the registration code is not a login code.
      await verifyOtp(phone, 'LOGIN', reg.body.devOtp).expect(401);
    });

    it('verifies with the code and signs the user in', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(phone).expect(201);
      const ver = await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(201);
      expect(ver.body.accessToken).toBeDefined();
      expect(ver.body.refreshToken).toBeDefined();

      const claims = decodeJwt(ver.body.accessToken);
      expect(claims.role).toBe('CAREGIVER');
      expect(claims.caregiverId).toBe(reg.body.caregiverId);
      expect(claims.email).toBeNull();
      expect(claims.phone).toBe(e164(phone));

      const user = await userRow(phone);
      expect(user.phoneVerifiedAt).not.toBeNull();
      expect(user.lastLoginAt).not.toBeNull();
    });

    it('accepts every common way of writing the same number', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(`+94 ${phone.slice(1, 3)} ${phone.slice(3, 6)} ${phone.slice(6)}`).expect(201);
      // verify using a different spelling than registration used
      await verifyOtp(`94${phone.slice(1)}`, 'REGISTER', reg.body.devOtp).expect(201);
    });
  });

  // ------------------------------------------------------------------------
  describe('customer (patient/guardian) registration', () => {
    it('registers, verifies and signs in', async () => {
      const phone = newPhone();
      const reg = await registerPatient(phone).expect(201);
      expect(reg.body.patientId).toBeDefined();
      expect(reg.body.otpSent).toBe(true);
      expect(reg.body.accessToken).toBeUndefined();

      const user = await userRow(phone);
      expect(user).toMatchObject({ email: null, passwordHash: null, role: 'PATIENT_GUARDIAN', phoneVerifiedAt: null });
      const [profile] = await db.select().from(patients).where(eq(patients.userId, user.id)).limit(1);
      expect(profile.phone).toBe(e164(phone));
      expect(profile.consentAcceptedAt).not.toBeNull();

      const ver = await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(201);
      const claims = decodeJwt(ver.body.accessToken);
      expect(claims).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId: reg.body.patientId, email: null });
    });

    it('validates input', async () => {
      await registerPatient('nope').expect(400);
      await registerPatient(newPhone(), { consentAccepted: false }).expect(400);
      await registerPatient(newPhone(), { fullName: 'A' }).expect(400);
    });
  });

  // ------------------------------------------------------------------------
  describe('same roles, permissions and access as email users', () => {
    let waCaregiver: Awaited<ReturnType<typeof verifiedCaregiver>>;
    let waPatient: Awaited<ReturnType<typeof verifiedPatient>>;
    let emailCaregiverToken: string;
    let emailCaregiverId: string;

    beforeAll(async () => {
      waCaregiver = await verifiedCaregiver();
      waPatient = await verifiedPatient();
      const res = await http.post('/auth/login').send({ email: 'selfregistered@care-platform.local', password: SEED_PASSWORD }).expect(201);
      emailCaregiverToken = res.body.accessToken;
      emailCaregiverId = decodeJwt(emailCaregiverToken).caregiverId;
    });

    it('a WhatsApp caregiver can open their own record, like an email caregiver', async () => {
      await api().get(`/caregivers/${waCaregiver.caregiverId}`).set(bearer(waCaregiver.tokens.accessToken)).expect(200);
      await api().get(`/caregivers/${emailCaregiverId}`).set(bearer(emailCaregiverToken)).expect(200);
    });

    it('cannot open another caregiver’s record, like an email caregiver', async () => {
      await api().get(`/caregivers/${emailCaregiverId}`).set(bearer(waCaregiver.tokens.accessToken)).expect(403);
      await api().get(`/caregivers/${waCaregiver.caregiverId}`).set(bearer(emailCaregiverToken)).expect(403);
    });

    it.each(['/caregivers', '/caregivers/dashboard', '/users', '/settings/whatsapp', '/audit'])(
      'gets the same answer as an email caregiver on %s',
      async (path) => {
        const email = await api().get(path).set(bearer(emailCaregiverToken));
        const wa = await api().get(path).set(bearer(waCaregiver.tokens.accessToken));
        expect(wa.status).toBe(email.status);
        expect(wa.status).not.toBe(200); // a caregiver must never get staff/admin data
      },
    );

    it('a WhatsApp customer is not a staff user either', async () => {
      for (const path of ['/caregivers', '/users', '/settings/whatsapp']) {
        const res = await api().get(path).set(bearer(waPatient.tokens.accessToken));
        expect([401, 403]).toContain(res.status);
      }
    });

    it('rejects unauthenticated and tampered tokens', async () => {
      await api().get(`/caregivers/${waCaregiver.caregiverId}`).expect(401);
      const bad = waCaregiver.tokens.accessToken.slice(0, -4) + 'AAAA';
      await api().get(`/caregivers/${waCaregiver.caregiverId}`).set(bearer(bad)).expect(401);
    });

    it('a deactivated WhatsApp account loses access immediately', async () => {
      const victim = await verifiedCaregiver();
      await api().get(`/caregivers/${victim.caregiverId}`).set(bearer(victim.tokens.accessToken)).expect(200);
      await db.update(users).set({ isActive: false }).where(eq(users.phone, e164(victim.phone)));
      await api().get(`/caregivers/${victim.caregiverId}`).set(bearer(victim.tokens.accessToken)).expect(401);
      await api().post('/auth/refresh').send({ refreshToken: victim.tokens.refreshToken }).expect(401);
      // and can't get a new session
      const res = await requestOtp(victim.phone, 'LOGIN').expect(201);
      expect(res.body.devOtp).toBeUndefined();
    });

    it('refresh-token rotation works for WhatsApp sessions', async () => {
      const user = await verifiedCaregiver();
      const refreshed = await api().post('/auth/refresh').send({ refreshToken: user.tokens.refreshToken }).expect(201);
      expect(refreshed.body.accessToken).toBeDefined();
      expect(decodeJwt(refreshed.body.accessToken)).toMatchObject({ role: 'CAREGIVER', caregiverId: user.caregiverId, phone: e164(user.phone) });
      // the old refresh token was rotated out
      await api().post('/auth/refresh').send({ refreshToken: user.tokens.refreshToken }).expect(401);
    });

    it('logout revokes the session', async () => {
      const user = await verifiedCaregiver();
      await api().post('/auth/logout').set(bearer(user.tokens.accessToken)).expect(201);
      await api().post('/auth/refresh').send({ refreshToken: user.tokens.refreshToken }).expect(401);
    });

    it('a WhatsApp account has no password to sign in with or change', async () => {
      const user = await verifiedCaregiver();
      await api().post('/auth/login').send({ email: 'nobody@example.com', password: 'whatever123' }).expect(401);
      const res = await api()
        .post('/auth/change-password')
        .set(bearer(user.tokens.accessToken))
        .send({ currentPassword: 'anything123', newPassword: 'AnotherPass123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/WhatsApp/);
    });
  });

  // ------------------------------------------------------------------------
  describe('login', () => {
    it('signs in a caregiver with a WhatsApp code', async () => {
      const { phone, caregiverId } = await verifiedCaregiver();
      const code = await loginCode(phone);
      const res = await verifyOtp(phone, 'LOGIN', code).expect(201);
      expect(decodeJwt(res.body.accessToken)).toMatchObject({ role: 'CAREGIVER', caregiverId });
    });

    it('signs in a customer with a WhatsApp code', async () => {
      const { phone, patientId } = await verifiedPatient();
      const code = await loginCode(phone);
      const res = await verifyOtp(phone, 'LOGIN', code).expect(201);
      expect(decodeJwt(res.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId });
    });

    it('signs in using a different spelling of the number', async () => {
      const { phone } = await verifiedCaregiver();
      await clearOtps(phone);
      const req = await requestOtp(`+94${phone.slice(1)}`, 'LOGIN').expect(201);
      await verifyOtp(phone, 'LOGIN', req.body.devOtp).expect(201);
    });

    it('answers identically for registered and unregistered numbers (no account enumeration)', async () => {
      const { phone } = await verifiedCaregiver();
      await clearOtps(phone);
      const known = await requestOtp(phone, 'LOGIN').expect(201);
      const unknown = await requestOtp(newPhone(), 'LOGIN').expect(201);
      const { devOtp: _d, ...knownShape } = known.body;
      expect(unknown.body).toEqual(knownShape);
      expect(unknown.body.devOtp).toBeUndefined();
    });

    it('rejects a wrong code', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone);
      const res = await verifyOtp(phone, 'LOGIN', wrongCode(code)).expect(401);
      expect(res.body.accessToken).toBeUndefined();
      // the right code still works afterwards (one miss is not a lockout)
      await verifyOtp(phone, 'LOGIN', code).expect(201);
    });

    it('rejects an expired code', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone);
      await expireOtps(phone);
      const res = await verifyOtp(phone, 'LOGIN', code).expect(401);
      expect(res.body.message).toMatch(/invalid or has expired/);
    });

    it('treats a wrong, expired and never-issued code identically', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone);
      const wrong = await verifyOtp(phone, 'LOGIN', wrongCode(code)).expect(401);
      await expireOtps(phone);
      const expired = await verifyOtp(phone, 'LOGIN', code).expect(401);
      const never = await verifyOtp(newPhone(), 'LOGIN', '123456').expect(401);
      expect(expired.body.message).toBe(wrong.body.message);
      expect(never.body.message).toBe(wrong.body.message);
    });

    it('rejects a code that was already used', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone);
      await verifyOtp(phone, 'LOGIN', code).expect(201);
      await verifyOtp(phone, 'LOGIN', code).expect(401);
    });

    it('rejects a code issued for a different number', async () => {
      const a = await verifiedCaregiver();
      const b = await verifiedCaregiver();
      const codeForA = await loginCode(a.phone);
      await clearOtps(b.phone);
      await verifyOtp(b.phone, 'LOGIN', codeForA).expect(401);
    });

    it('rejects a code issued for a different purpose', async () => {
      const { phone } = await verifiedCaregiver();
      const loginOnly = await loginCode(phone, 'LOGIN');
      await verifyOtp(phone, 'RECOVERY', loginOnly).expect(401);
    });

    it('locks a code after too many wrong guesses, even if the right one is then entered', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone);
      for (let i = 0; i < 5; i++) await verifyOtp(phone, 'LOGIN', wrongCode(code)).expect(401);
      await verifyOtp(phone, 'LOGIN', code).expect(401); // burnt
      // a fresh code works once the resend window has passed
      await clearOtps(phone);
      const fresh = (await requestOtp(phone, 'LOGIN').expect(201)).body.devOtp;
      await verifyOtp(phone, 'LOGIN', fresh).expect(201);
    });

    it('only the newest code works after a resend', async () => {
      const { phone } = await verifiedCaregiver();
      const first = await loginCode(phone);
      await db.execute(sql`UPDATE whatsapp_otps SET created_at = created_at - INTERVAL 5 MINUTE WHERE phone = ${e164(phone)}`);
      const second = (await requestOtp(phone, 'LOGIN').expect(201)).body.devOtp;
      expect(second).toBeDefined();
      if (first !== second) await verifyOtp(phone, 'LOGIN', first).expect(401);
      await verifyOtp(phone, 'LOGIN', second).expect(201);
    });

    it('enforces the resend cooldown without revealing it', async () => {
      const { phone } = await verifiedCaregiver();
      const first = await loginCode(phone);
      const again = await requestOtp(phone, 'LOGIN').expect(201);
      expect(again.body.devOtp).toBeUndefined(); // nothing new was issued
      await verifyOtp(phone, 'LOGIN', first).expect(201); // the original is still the live one
    });

    it('enforces the hourly send cap', async () => {
      await setSettings({ otpMaxSendsPerHour: 2 }).expect(200);
      try {
        const { phone } = await verifiedCaregiver(); // its registration code counts as send #1
        await clearOtps(phone);
        await requestOtp(phone, 'LOGIN').expect(201); // #1 after clear
        await db.execute(sql`UPDATE whatsapp_otps SET created_at = created_at - INTERVAL 5 MINUTE WHERE phone = ${e164(phone)}`);
        await requestOtp(phone, 'LOGIN').expect(201); // #2
        await db.execute(sql`UPDATE whatsapp_otps SET created_at = created_at - INTERVAL 5 MINUTE WHERE phone = ${e164(phone)}`);
        const capped = await requestOtp(phone, 'LOGIN').expect(201); // over the cap: silently not sent
        expect(capped.body.devOtp).toBeUndefined();
      } finally {
        await setSettings({ otpMaxSendsPerHour: 20 }).expect(200);
      }
    });

    it('rejects malformed input', async () => {
      await verifyOtp('0771234567', 'LOGIN', 'abc').expect(400);
      await verifyOtp('0771234567', 'LOGIN', '12').expect(400);
      await verifyOtp('0771234567', 'LOGIN', '123456789').expect(400);
      await verifyOtp('bad', 'LOGIN', '123456').expect(400);
      await api().post('/auth/whatsapp/verify-otp').send({ phone: '0771234567', purpose: 'HACK', code: '123456' }).expect(400);
      await api().post('/auth/whatsapp/request-otp').send({ phone: '0771234567' }).expect(400);
    });

    it('honours a different OTP length from the admin settings', async () => {
      await setSettings({ otpLength: 8 }).expect(200);
      try {
        const { phone } = await verifiedCaregiver();
        await clearOtps(phone);
        const res = await requestOtp(phone, 'LOGIN').expect(201);
        expect(res.body.devOtp).toMatch(/^\d{8}$/);
        await verifyOtp(phone, 'LOGIN', res.body.devOtp).expect(201);
      } finally {
        await setSettings({ otpLength: 6 }).expect(200);
      }
    });

    it('honours the expiry from the admin settings', async () => {
      await setSettings({ otpTtlSeconds: 120 }).expect(200);
      try {
        const { phone } = await verifiedCaregiver();
        const code = await loginCode(phone);
        const [row] = (await db.execute(sql`SELECT TIMESTAMPDIFF(SECOND, created_at, expires_at) AS ttl FROM whatsapp_otps WHERE phone = ${e164(phone)} ORDER BY created_at DESC LIMIT 1`)) as any;
        expect(Number(row[0].ttl)).toBe(120);
        await verifyOtp(phone, 'LOGIN', code).expect(201);
      } finally {
        await setSettings({ otpTtlSeconds: 300 }).expect(200);
      }
    });

    it('staff accounts can never sign in with WhatsApp, even with a phone on the row', async () => {
      const phone = newPhone();
      const [admin] = await db.select().from(users).where(eq(users.email, 'verifier@care-platform.local')).limit(1);
      await db.update(users).set({ phone: e164(phone), phoneVerifiedAt: new Date() }).where(eq(users.id, admin.id));
      try {
        const res = await requestOtp(phone, 'LOGIN').expect(201);
        expect(res.body.devOtp).toBeUndefined();
        await verifyOtp(phone, 'LOGIN', '123456').expect(401);
      } finally {
        await db.update(users).set({ phone: null, phoneVerifiedAt: null }).where(eq(users.id, admin.id));
      }
    });
  });

  // ------------------------------------------------------------------------
  describe('registration verification (REGISTER purpose)', () => {
    it('rejects a wrong registration code and leaves the account unverified', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(phone).expect(201);
      await verifyOtp(phone, 'REGISTER', wrongCode(reg.body.devOtp)).expect(401);
      expect((await userRow(phone)).phoneVerifiedAt).toBeNull();
    });

    it('rejects an expired registration code, then lets the user request a new one', async () => {
      const phone = newPhone();
      const reg = await registerCaregiver(phone).expect(201);
      await expireOtps(phone);
      await verifyOtp(phone, 'REGISTER', reg.body.devOtp).expect(401);
      expect((await userRow(phone)).phoneVerifiedAt).toBeNull();

      await clearOtps(phone);
      const resend = await requestOtp(phone, 'REGISTER').expect(201);
      expect(resend.body.devOtp).toMatch(/^\d{6}$/);
      await verifyOtp(phone, 'REGISTER', resend.body.devOtp).expect(201);
      expect((await userRow(phone)).phoneVerifiedAt).not.toBeNull();
    });

    it('does not offer a registration resend for an already-verified number', async () => {
      const { phone } = await verifiedCaregiver();
      await clearOtps(phone);
      const res = await requestOtp(phone, 'REGISTER').expect(201);
      expect(res.body.devOtp).toBeUndefined();
    });

    it('a verified number cannot be re-verified to hijack the session', async () => {
      const { phone } = await verifiedCaregiver();
      await clearOtps(phone);
      await verifyOtp(phone, 'REGISTER', '123456').expect(401);
    });
  });

  // ------------------------------------------------------------------------
  describe('account recovery', () => {
    it('signs the user back in and revokes every older session', async () => {
      const { phone, tokens, caregiverId } = await verifiedCaregiver();
      // a second device
      const laptopCode = await loginCode(phone);
      const laptop = (await verifyOtp(phone, 'LOGIN', laptopCode).expect(201)).body;

      const code = await loginCode(phone, 'RECOVERY');
      const res = await verifyOtp(phone, 'RECOVERY', code).expect(201);
      expect(decodeJwt(res.body.accessToken)).toMatchObject({ role: 'CAREGIVER', caregiverId });

      await api().post('/auth/refresh').send({ refreshToken: tokens.refreshToken }).expect(401);
      await api().post('/auth/refresh').send({ refreshToken: laptop.refreshToken }).expect(401);
      // the recovery session itself is good
      await api().post('/auth/refresh').send({ refreshToken: res.body.refreshToken }).expect(201);
    });

    it('works for customers too', async () => {
      const { phone, patientId } = await verifiedPatient();
      const code = await loginCode(phone, 'RECOVERY');
      const res = await verifyOtp(phone, 'RECOVERY', code).expect(201);
      expect(decodeJwt(res.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId });
    });

    it('does not reveal whether the number has an account', async () => {
      const { phone } = await verifiedCaregiver();
      await clearOtps(phone);
      const known = await requestOtp(phone, 'RECOVERY').expect(201);
      const unknown = await requestOtp(newPhone(), 'RECOVERY').expect(201);
      const { devOtp: _d, ...knownShape } = known.body;
      expect(unknown.body).toEqual(knownShape);
    });

    it('rejects a wrong or expired recovery code', async () => {
      const { phone } = await verifiedCaregiver();
      const code = await loginCode(phone, 'RECOVERY');
      await verifyOtp(phone, 'RECOVERY', wrongCode(code)).expect(401);
      await expireOtps(phone);
      await verifyOtp(phone, 'RECOVERY', code).expect(401);
    });

    it('never signs in a number that has no account', async () => {
      await verifyOtp(newPhone(), 'RECOVERY', '123456').expect(401);
    });
  });

  // ------------------------------------------------------------------------
  describe('duplicate accounts', () => {
    it('blocks a second WhatsApp registration of a verified number, in any spelling', async () => {
      const { phone } = await verifiedCaregiver();
      await registerCaregiver(phone).expect(409);
      await registerCaregiver(`+94${phone.slice(1)}`).expect(409);
      await registerCaregiver(`94${phone.slice(1)}`).expect(409);
      await registerPatient(phone).expect(409); // a different role can't take the number either
    });

    it('blocks the same number across roles, customer first', async () => {
      const { phone } = await verifiedPatient();
      await registerCaregiver(phone).expect(409);
      await registerPatient(`+94${phone.slice(1)}`).expect(409);
    });

    it('blocks a caregiver whose NIC is already registered', async () => {
      const nic = `${String(runBase).padStart(9, '0').slice(-9)}V`;
      await registerCaregiver(newPhone(), { nic }).expect(201);
      await registerCaregiver(newPhone(), { nic }).expect(409);
    });

    it('lets an unverified signup be redone, replacing the abandoned one (no number squatting)', async () => {
      const phone = newPhone();
      const squatter = await registerCaregiver(phone, { fullName: 'Squatter Name' }).expect(201);
      await clearOtps(phone);
      const real = await registerCaregiver(phone, { fullName: 'Real Owner' }).expect(201);
      expect(real.body.caregiverId).not.toBe(squatter.body.caregiverId);

      const rows = await db.select().from(users).where(eq(users.phone, e164(phone)));
      expect(rows).toHaveLength(1);
      expect(rows[0].fullName).toBe('Real Owner');
      const orphan = await db.select().from(caregivers).where(eq(caregivers.id, squatter.body.caregiverId));
      expect(orphan).toHaveLength(0);

      await verifyOtp(phone, 'REGISTER', real.body.devOtp).expect(201);
    });

    it('does not let a verified number be overwritten by re-registering', async () => {
      const { phone, caregiverId } = await verifiedCaregiver();
      await clearOtps(phone);
      await registerCaregiver(phone, { fullName: 'Takeover Attempt' }).expect(409);
      const [profile] = await db.select().from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
      expect(profile.fullName).not.toBe('Takeover Attempt');
    });

    it('blocks WhatsApp registration when a caregiver record already has that phone (e.g. entered by staff)', async () => {
      const phone = newPhone();
      await api()
        .post('/caregivers')
        .set(bearer(adminToken))
        .send({
          fullName: 'Staff Entered',
          permanentAddress: '1 Staff Rd',
          dateOfBirth: '1990-01-01',
          gender: 'MALE',
          civilStatus: 'SINGLE',
          primaryPhone: phone,
          emergencyContactName: 'Emergency Person',
          emergencyContactNumber: '0770000000',
          emergencyContactRelationship: 'Relative',
        })
        .expect(201);
      await registerCaregiver(phone).expect(409);
      await registerCaregiver(`+94${phone.slice(1)}`).expect(409);
    });

    it('blocks an email caregiver registration whose phone is already a WhatsApp login', async () => {
      const { phone } = await verifiedCaregiver();
      const res = await api()
        .post('/auth/register-caregiver')
        .send({
          email: `dup-${phone}@example.com`,
          password: 'SelfRegPass123',
          consentAccepted: true,
          fullName: 'Email Duplicate',
          permanentAddress: '9 Dup Lane',
          dateOfBirth: '1990-02-02',
          gender: 'FEMALE',
          civilStatus: 'SINGLE',
          primaryPhone: phone, // typed differently from the stored +94… form
          emergencyContactName: 'Emergency Person',
          emergencyContactNumber: '0770000000',
          emergencyContactRelationship: 'Relative',
        })
        .expect(409);
      expect(res.body.message).toMatch(/WhatsApp/);
    });

    it('blocks an email customer registration whose phone is already a WhatsApp login', async () => {
      const { phone } = await verifiedPatient();
      await api()
        .post('/auth/register-patient')
        .send({ email: `dup-${phone}@example.com`, password: 'SelfRegPass123', fullName: 'Email Duplicate', phone, consentAccepted: true })
        .expect(409);
    });

    it('lets an email customer register with no phone, or an unrelated one (email flow unchanged)', async () => {
      await api()
        .post('/auth/register-patient')
        .send({ email: `plain-${runBase}-a@example.com`, password: 'SelfRegPass123', fullName: 'Plain Email', consentAccepted: true })
        .expect(201);
      await api()
        .post('/auth/register-patient')
        .send({ email: `plain-${runBase}-b@example.com`, password: 'SelfRegPass123', fullName: 'Plain Email Two', phone: newPhone(), consentAccepted: true })
        .expect(201);
    });
  });

  // ------------------------------------------------------------------------
  describe('email/password authentication is unchanged', () => {
    it('still logs in the seeded users', async () => {
      for (const email of ['admin@care-platform.local', 'staff@care-platform.local', 'verifier@care-platform.local', 'selfregistered@care-platform.local']) {
        const res = await api().post('/auth/login').send({ email, password: SEED_PASSWORD }).expect(201);
        expect(decodeJwt(res.body.accessToken).email).toBe(email);
      }
    });

    it('still rejects bad credentials and bad emails', async () => {
      await api().post('/auth/login').send({ email: 'admin@care-platform.local', password: 'wrong-password' }).expect(401);
      await api().post('/auth/login').send({ email: 'not-an-email', password: SEED_PASSWORD }).expect(400);
    });

    it('still registers, verifies and logs in an email customer end to end', async () => {
      const email = `e2e-email-${runBase}@example.com`;
      const reg = await api()
        .post('/auth/register-patient')
        .send({ email, password: 'SelfRegPass123', fullName: 'Email Customer', consentAccepted: true })
        .expect(201);
      expect(reg.body.devVerificationUrl).toContain('/verify-email?token=');
      await api().post('/auth/login').send({ email, password: 'SelfRegPass123' }).expect(401); // not verified yet
      const token = new URL(reg.body.devVerificationUrl).searchParams.get('token');
      const ver = await api().post('/auth/verify-email').send({ token }).expect(201);
      expect(decodeJwt(ver.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', email });
      await api().post('/auth/login').send({ email, password: 'SelfRegPass123' }).expect(201);
    });

    it('email tokens carry no phone claim, and the same change-password still works', async () => {
      const email = `e2e-pw-${runBase}@example.com`;
      const reg = await api().post('/auth/register-patient').send({ email, password: 'SelfRegPass123', fullName: 'PW User', consentAccepted: true }).expect(201);
      const ver = await api().post('/auth/verify-email').send({ token: new URL(reg.body.devVerificationUrl).searchParams.get('token') }).expect(201);
      expect(decodeJwt(ver.body.accessToken).phone).toBeUndefined();
      await api()
        .post('/auth/change-password')
        .set(bearer(ver.body.accessToken))
        .send({ currentPassword: 'SelfRegPass123', newPassword: 'NewerPass12345' })
        .expect(201);
    });
  });
});

// --------------------------------------------------------------------------
describe('WhatsApp endpoint rate limiting (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp({ throttle: true });
    adminToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    await request(app.getHttpServer()).patch('/settings/whatsapp').set({ Authorization: `Bearer ${adminToken}` }).send({ enabled: true, provider: 'CONSOLE' }).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('throttles repeated code requests from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await request(app.getHttpServer()).post('/auth/whatsapp/request-otp').send({ phone: '0771110000', purpose: 'LOGIN' })).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses).toContain(429);
  });

  it('throttles code guessing from one client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      statuses.push((await request(app.getHttpServer()).post('/auth/whatsapp/verify-otp').send({ phone: '0771110001', purpose: 'LOGIN', code: '123456' })).status);
    }
    expect(statuses).toContain(429);
  });
});
