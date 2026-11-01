import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { createHash, randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { users } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * Google, Microsoft and Facebook sign-in for clients as well as caregivers,
 * and from the mobile app, over real HTTP against the real database. Only
 * Google's own servers are stood in for (as in social-auth.e2e-spec).
 *
 * - A client links a provider at registration (which also confirms their
 *   address) or from My account, then signs in with it on the client side.
 * - A provider identity signs in only on its own side.
 * - The app gets the result through its URL scheme, and its one-time code
 *   works only with the verifier behind the challenge it sent.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const decodeJwt = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const GOOGLE = { clientId: 'e2e-google-id.apps.googleusercontent.com', clientSecret: 'GOCSPX-e2e-secret-value' };

describe('Social sign-in for clients and the app (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let adminToken: string;
  let staffToken: string;
  let web: string;
  let intake: Record<string, unknown>;
  const realFetch = global.fetch;
  let profile: { sub: string; email: string };

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `074${String(run * 1000 + ++n).padStart(7, '0')}`;
  const newEmail = () => `social-${run}-${++n}@example.com`;
  const nonce = () => randomBytes(12).toString('hex');
  const verifierAndChallenge = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };
  const signInAs = (sub: string, email: string) => {
    profile = { sub, email };
  };

  /** The provider's consent screen, answered: the callback's redirect. */
  async function roundTrip(url: string) {
    const state = new URL(url).searchParams.get('state')!;
    const res = await api().get('/auth/social/google/callback').query({ code: 'provider-code', state }).expect(302);
    return new URL(res.headers.location);
  }
  const linkWith = async (pendingToken: string) => roundTrip((await api().get('/auth/social/google/authorize-url').query({ token: pendingToken }).expect(200)).body.url);
  const signIn = async (query: Record<string, string>) => roundTrip((await api().get('/auth/social/google/login-url').query({ nonce: nonce(), ...query }).expect(200)).body.url);
  const exchange = (code: string, verifier?: string) => api().post('/auth/social/exchange').send({ code, ...(verifier ? { verifier } : {}) });

  async function registerClient(email = newEmail()) {
    const password = 'ClientPass123';
    const res = await api()
      .post('/auth/register-patient')
      .send({ email, password, fullName: 'Kamala Perera', phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    return { email, password, ...res.body } as { email: string; password: string; patientId: string; pendingToken: string; providers: Record<string, boolean> };
  }

  async function linkedCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
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
    const sub = `g-cg-${run}-${++n}`;
    signInAs(sub, newEmail());
    const back = await linkWith(reg.body.pendingToken);
    expect(back.searchParams.get('code')).toBeTruthy();
    return { sub, email: profile.email };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    web = (app.get(ConfigService).get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/$/, '');

    adminToken = (await api().post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    staffToken = (await api().post('/auth/login').send({ email: 'staff@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    await db.execute(sql`DELETE FROM social_auth_provider_settings`);
    await api().patch('/settings/social-auth/google').set(bearer(adminToken)).send({ enabled: true, ...GOOGLE }).expect(200);

    global.fetch = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'provider-access-token' }), { status: 200 });
      if (url.includes('openidconnect.googleapis.com/v1/userinfo')) return new Response(JSON.stringify({ ...profile, email_verified: true, name: 'E2E' }), { status: 200 });
      return realFetch(input, init);
    }) as never;

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
    global.fetch = realFetch;
    await db.execute(sql`DELETE FROM social_auth_provider_settings`);
    await app.close();
  });

  describe('clients on the website', () => {
    it('link a provider at registration, which confirms the address, then sign in with it on the client side', async () => {
      const client = await registerClient();
      expect(client.providers).toMatchObject({ GOOGLE: true });
      expect(client).not.toHaveProperty('userId');
      // Not yet confirmed: email sign-in waits.
      await api().post('/auth/login').send({ email: client.email, password: client.password, portal: 'customer' }).expect(401);

      const sub = `g-cl-${run}-${++n}`;
      signInAs(sub, client.email);
      const linked = await linkWith(client.pendingToken);
      expect(`${linked.origin}${linked.pathname}`).toBe(`${web}/social/callback`);
      const first = await exchange(linked.searchParams.get('code')!).expect(201);
      expect(decodeJwt(first.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId: client.patientId });
      // The provider vouched for the address, so email sign-in works too now.
      await api().post('/auth/login').send({ email: client.email, password: client.password, portal: 'customer' }).expect(201);

      const back = await signIn({ side: 'client' });
      expect(`${back.origin}${back.pathname}`).toBe(`${web}/social/callback`);
      expect(back.searchParams.get('flow')).toBe('login');
      expect(back.searchParams.get('nonce')).toBeTruthy();
      const session = await exchange(back.searchParams.get('code')!).expect(201);
      expect(decodeJwt(session.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId: client.patientId });
    });

    it('link one from My account, and see their sign-in methods', async () => {
      const client = await registerClient();
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.email, client.email));
      const token = (await api().post('/auth/login').send({ email: client.email, password: client.password, portal: 'customer' }).expect(201)).body.accessToken;

      expect((await api().get('/me/sign-in-methods').set(bearer(token)).expect(200)).body).toEqual({
        email: client.email,
        password: true,
        linked: [],
        providers: expect.objectContaining({ GOOGLE: true }),
      });

      // Only an account with that address can be linked to it.
      const grant = (await api().post('/me/social/link-grant').set(bearer(token)).expect(200)).body;
      signInAs(`g-other-${run}-${++n}`, newEmail());
      const refused = await linkWith(grant.pendingToken);
      expect(refused.searchParams.get('error')).toBe('email_mismatch');
      expect(`${refused.origin}${refused.pathname}`).toBe(`${web}/social/callback`);

      signInAs(`g-mine-${run}-${++n}`, client.email);
      const ok = await linkWith((await api().post('/me/social/link-grant').set(bearer(token)).expect(200)).body.pendingToken);
      expect(ok.searchParams.get('code')).toBeTruthy();
      expect((await api().get('/me/sign-in-methods').set(bearer(token)).expect(200)).body.linked).toEqual(['GOOGLE']);
    });

    it('is only for caregivers and clients', async () => {
      await api().get('/me/sign-in-methods').set(bearer(staffToken)).expect(403);
      await api().post('/me/social/link-grant').set(bearer(staffToken)).expect(403);
      await api().get('/me/sign-in-methods').expect(401);
    });

    it("signs in only on the account's own side", async () => {
      const caregiver = await linkedCaregiver();
      signInAs(caregiver.sub, caregiver.email);
      const asClient = await signIn({ side: 'client' });
      expect(`${asClient.origin}${asClient.pathname}`).toBe(`${web}/social/callback`);
      expect(asClient.searchParams.get('error')).toBe('wrong_portal');
      expect(asClient.searchParams.get('code')).toBeNull();

      // The default is the caregiver side, as before.
      const asCaregiver = await signIn({});
      expect(`${asCaregiver.origin}${asCaregiver.pathname}`).toBe(`${web}/caregiver/social/callback`);
      expect(decodeJwt((await exchange(asCaregiver.searchParams.get('code')!).expect(201)).body.accessToken).role).toBe('CAREGIVER');

      const client = await registerClient();
      signInAs(`g-cl2-${run}-${++n}`, client.email);
      await linkWith(client.pendingToken);
      const clientOnCaregiverSide = await signIn({ side: 'caregiver' });
      expect(clientOnCaregiverSide.searchParams.get('error')).toBe('wrong_portal');
      expect(`${clientOnCaregiverSide.origin}${clientOnCaregiverSide.pathname}`).toBe(`${web}/caregiver/social/callback`);
    });

    it("won't link a caregiver's login through a client grant", async () => {
      // An active caregiver with an address, so only the side can stop the link.
      const caregiver = await linkedCaregiver();
      const [caregiverUser] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, caregiver.email)).limit(1);
      // A grant naming the client side for a caregiver's login - which the server never issues.
      const forged = app.get(JwtService).sign(
        { sub: caregiverUser.id, typ: 'caregiver-social-signup', side: 'client' },
        { secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET'), expiresIn: '15m' },
      );
      signInAs(`g-forged-${run}-${++n}`, caregiverUser.email!);
      const back = await linkWith(forged);
      expect(back.searchParams.get('error')).toBe('registration_gone');
    });

    it('tells someone with no linked account to register', async () => {
      signInAs(`g-nobody-${run}-${++n}`, newEmail());
      const back = await signIn({ side: 'client' });
      expect(back.searchParams.get('error')).toBe('not_registered');
      expect(`${back.origin}${back.pathname}`).toBe(`${web}/social/callback`);
    });
  });

  describe('the mobile app', () => {
    it('needs a challenge, and gets the result through its own scheme', async () => {
      await api().get('/auth/social/google/login-url').query({ nonce: nonce(), client: 'app', side: 'client' }).expect(400);
      await api().get('/auth/social/google/login-url').query({ nonce: nonce(), client: 'app', challenge: 'too-short' }).expect(400);

      const client = await registerClient();
      signInAs(`g-app-${run}-${++n}`, client.email);
      await linkWith(client.pendingToken);

      const { verifier, challenge } = verifierAndChallenge();
      const back = await signIn({ side: 'client', client: 'app', challenge });
      expect(`${back.protocol}//${back.host}${back.pathname}`).toBe('carelink://auth/callback');
      expect(back.searchParams.get('flow')).toBe('login');
      const session = await exchange(back.searchParams.get('code')!, verifier).expect(201);
      expect(decodeJwt(session.body.accessToken)).toMatchObject({ role: 'PATIENT_GUARDIAN', patientId: client.patientId });
    });

    it("refuses the app's code without the right verifier, and burns it", async () => {
      const caregiver = await linkedCaregiver();
      signInAs(caregiver.sub, caregiver.email);
      const { verifier, challenge } = verifierAndChallenge();

      const one = await signIn({ client: 'app', challenge });
      await exchange(one.searchParams.get('code')!).expect(401);
      // Spent by the failed attempt: the right verifier is too late.
      await exchange(one.searchParams.get('code')!, verifier).expect(401);

      const two = await signIn({ client: 'app', challenge });
      await exchange(two.searchParams.get('code')!, verifierAndChallenge().verifier).expect(401);

      const three = await signIn({ client: 'app', challenge });
      expect(decodeJwt((await exchange(three.searchParams.get('code')!, verifier).expect(201)).body.accessToken).role).toBe('CAREGIVER');
    });

    it('sends failures back to the app too', async () => {
      signInAs(`g-app-nobody-${run}-${++n}`, newEmail());
      const back = await signIn({ side: 'client', client: 'app', challenge: verifierAndChallenge().challenge });
      expect(`${back.protocol}//${back.host}${back.pathname}`).toBe('carelink://auth/callback');
      expect(back.searchParams.get('error')).toBe('not_registered');
      expect(back.searchParams.get('flow')).toBe('login');

      // Declined on the provider's screen.
      const started = await api().get('/auth/social/google/login-url').query({ nonce: nonce(), client: 'app', challenge: verifierAndChallenge().challenge }).expect(200);
      const state = new URL(started.body.url).searchParams.get('state')!;
      const declined = await api().get('/auth/social/google/callback').query({ error: 'access_denied', state }).expect(302);
      expect(declined.headers.location).toBe('carelink://auth/callback?error=declined&flow=login');
    });
  });
});
