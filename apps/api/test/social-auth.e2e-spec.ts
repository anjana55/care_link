import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { users, socialAccounts, socialAuthProviderSettings } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * End-to-end coverage for Google / Microsoft / Facebook sign-in and its admin
 * settings, against the real database and the real HTTP stack.
 *
 * Only the three providers' own servers are replaced: `fetch` (which the
 * provider clients use; supertest does not) answers their token and userinfo
 * endpoints. Everything else - routing, validation, the settings read from the
 * database and decrypted, the state tokens, the handoff-code exchange, the JWT
 * pair - is the production code path. That is the point: the unit tests pass the
 * provider name in the canonical case and mock the registry, which let a
 * `google` vs `GOOGLE` mismatch in the callback URL go unnoticed.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const decodeJwt = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

type Profile = { sub: string; email: string };

describe('Social sign-in and its admin settings (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let adminToken: string;
  let staffToken: string;
  const realFetch = global.fetch;
  let fetchCalls: { url: string; body: string }[] = [];
  let googleProfile: Profile;
  let tokenReply: { status: number; body: unknown } | null = null;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const runBase = Math.floor(Date.now() / 1000) % 10_000;
  let counter = 0;
  const newPhone = () => `077${String(runBase * 1000 + ++counter).padStart(7, '0')}`;
  const nonce = () => 'n'.repeat(8) + Math.random().toString(16).slice(2, 18).padEnd(16, '0');

  const GOOGLE = { clientId: 'e2e-google-id.apps.googleusercontent.com', clientSecret: 'GOCSPX-e2e-secret-value' };

  const saveProvider = (provider: string, patch: Record<string, unknown>) =>
    api().patch(`/settings/social-auth/${provider}`).set(bearer(adminToken)).send(patch);

  /** Stands in for the providers' servers. Records every call so tests can see what the API sent. */
  function stubProviders() {
    global.fetch = jest.fn(async (input: any, init?: any) => {
      const url = String(input);
      fetchCalls.push({ url, body: String(init?.body ?? '') });
      if (url.includes('oauth2.googleapis.com/token')) {
        const reply = tokenReply ?? { status: 200, body: { access_token: 'provider-access-token' } };
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }
      if (url.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return new Response(JSON.stringify({ ...googleProfile, email_verified: true, name: 'E2E Person' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as never;
  }

  async function registerCaregiver(email?: string) {
    const phone = newPhone();
    const res = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
        ...(email ? { email } : {}),
        consentAccepted: true,
        fullName: `Social Caregiver ${phone}`,
        permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1992-06-15',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        emergencyContactName: 'EC Person',
        emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Sister',
      })
      .expect(201);
    return { phone, pendingToken: res.body.pendingToken as string, providers: res.body.providers };
  }

  const stateOf = (location: string) => new URL(location).searchParams.get('state')!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);

    adminToken = (await api().post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    staffToken = (await api().post('/auth/login').send({ email: 'staff@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    expect(adminToken).toBeDefined();

    // Start from a known state regardless of what a previous run left behind.
    await db.execute(sql`DELETE FROM social_auth_provider_settings`);
    stubProviders();
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await db.execute(sql`DELETE FROM social_auth_provider_settings`);
    await app.close();
  });

  beforeEach(() => {
    fetchCalls = [];
    tokenReply = null;
    googleProfile = { sub: `g-${Math.random().toString(16).slice(2)}`, email: `person${Date.now()}${counter}@example.com` };
  });

  describe('admin settings', () => {
    it('is admin-only', async () => {
      await api().get('/settings/social-auth').expect(401);
      await api().get('/settings/social-auth').set(bearer(staffToken)).expect(403);
      await api().patch('/settings/social-auth/google').set(bearer(staffToken)).send({ enabled: false }).expect(403);
      await api().post('/settings/social-auth/google/test').set(bearer(staffToken)).expect(403);
    });

    it('lists all three providers, switched off, with the callback URL to register', async () => {
      const res = await api().get('/settings/social-auth').set(bearer(adminToken)).expect(200);

      expect(res.body.map((p: any) => p.provider)).toEqual(['GOOGLE', 'MICROSOFT', 'FACEBOOK']);
      for (const p of res.body) {
        expect(p.enabled).toBe(false);
        expect(p.clientSecretSet).toBe(false);
        expect(p.redirectUri).toMatch(new RegExp(`/auth/social/${p.provider.toLowerCase()}/callback$`));
      }
      expect(res.body[1].tenant).toBe('common');
      expect(res.body[2].apiVersion).toBe('v21.0');
      expect((await api().get('/auth/social/providers').expect(200)).body).toEqual({ GOOGLE: false, MICROSOFT: false, FACEBOOK: false });
    });

    it('will not switch a provider on without credentials', async () => {
      const res = await saveProvider('google', { enabled: true }).expect(400);
      expect(res.body.message).toMatch(/client ID, client secret/);
    });

    it('rejects an unknown provider and malformed values', async () => {
      await saveProvider('twitter', { enabled: false }).expect(400);
      await saveProvider('microsoft', { tenant: 'not a tenant!' }).expect(400);
      await saveProvider('facebook', { apiVersion: '21' }).expect(400);
    });

    it('saves a provider, encrypts the secret, and never returns it', async () => {
      const res = await saveProvider('google', { enabled: true, ...GOOGLE }).expect(200);

      expect(res.body).toMatchObject({ provider: 'GOOGLE', enabled: true, clientId: GOOGLE.clientId, clientSecretSet: true, usable: true });
      expect(res.body.clientSecretHint).toBe('••••alue');
      expect(JSON.stringify(res.body)).not.toContain(GOOGLE.clientSecret);
      expect(JSON.stringify((await api().get('/settings/social-auth').set(bearer(adminToken))).body)).not.toContain(GOOGLE.clientSecret);

      const [stored] = await db.select().from(socialAuthProviderSettings).where(eq(socialAuthProviderSettings.provider, 'GOOGLE'));
      expect(stored.clientSecretEncrypted).toMatch(/^v1:/);
      expect(stored.clientSecretEncrypted).not.toContain(GOOGLE.clientSecret);
    });

    it('shows the public sign-in screens only the providers that are on', async () => {
      expect((await api().get('/auth/social/providers').expect(200)).body).toEqual({ GOOGLE: true, MICROSOFT: false, FACEBOOK: false });
    });

    it('tests the saved credentials against the provider', async () => {
      tokenReply = { status: 400, body: { error: 'invalid_grant', error_description: 'Malformed auth code.' } };
      const good = await api().post('/settings/social-auth/google/test').set(bearer(adminToken)).expect(201);
      expect(good.body.ok).toBe(true);
      // It used the saved, decrypted credentials and the real callback URL.
      const sent = new URLSearchParams(fetchCalls.at(-1)!.body);
      expect(sent.get('client_id')).toBe(GOOGLE.clientId);
      expect(sent.get('client_secret')).toBe(GOOGLE.clientSecret);
      expect(sent.get('redirect_uri')).toMatch(/\/auth\/social\/google\/callback$/);

      tokenReply = { status: 401, body: { error: 'invalid_client' } };
      const bad = await api().post('/settings/social-auth/google/test').set(bearer(adminToken)).expect(201);
      expect(bad.body.ok).toBe(false);
      expect(JSON.stringify(bad.body)).not.toContain(GOOGLE.clientSecret);
    });

    it('says so when there is nothing to test', async () => {
      const res = await api().post('/settings/social-auth/facebook/test').set(bearer(adminToken)).expect(201);
      expect(res.body).toMatchObject({ ok: false });
      expect(res.body.message).toMatch(/save a client ID/i);
    });

    it('asks for the secret again when the client ID changes', async () => {
      await saveProvider('google', { clientId: 'another-app' }).expect(400);
    });
  });

  describe('registering with a provider (the callback URL uses the lowercase name)', () => {
    it('links the provider, fills in the missing email, and signs the caregiver in', async () => {
      const { pendingToken, providers } = await registerCaregiver(); // no email on the form
      expect(providers.GOOGLE).toBe(true);

      const auth = await api().get('/auth/social/google/authorize-url').query({ token: pendingToken }).expect(200);
      const consent = new URL(auth.body.url);
      expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(consent.searchParams.get('client_id')).toBe(GOOGLE.clientId);
      expect(consent.searchParams.get('redirect_uri')).toMatch(/\/auth\/social\/google\/callback$/);
      expect(consent.searchParams.get('response_type')).toBe('code');
      expect(stateOf(auth.body.url)).toBe(pendingToken);

      const cb = await api()
        .get('/auth/social/google/callback')
        .query({ code: 'provider-auth-code', state: stateOf(auth.body.url) })
        .expect(302);
      const landing = new URL(cb.headers.location);
      expect(landing.pathname).toBe('/caregiver/social/callback');
      const handoff = landing.searchParams.get('code')!;
      expect(handoff).toMatch(/^[0-9a-f]{64}$/);

      // The token exchange used the saved credentials and the very redirect URI that was offered.
      const exchange = new URLSearchParams(fetchCalls.find((c) => c.url.includes('/token'))!.body);
      expect(exchange.get('code')).toBe('provider-auth-code');
      expect(exchange.get('client_secret')).toBe(GOOGLE.clientSecret);
      expect(exchange.get('redirect_uri')).toBe(consent.searchParams.get('redirect_uri'));

      const tokens = (await api().post('/auth/social/exchange').send({ code: handoff }).expect(201)).body;
      const claims = decodeJwt(tokens.accessToken);
      expect(claims.role).toBe('CAREGIVER');

      const [link] = await db.select().from(socialAccounts).where(eq(socialAccounts.providerAccountId, googleProfile.sub));
      expect(link.provider).toBe('GOOGLE');
      expect(link.userId).toBe(claims.sub);
      const [user] = await db.select().from(users).where(eq(users.id, claims.sub));
      expect(user.email).toBe(googleProfile.email);
      expect(user.emailVerifiedAt).not.toBeNull();

      // A handoff code is single use.
      await api().post('/auth/social/exchange').send({ code: handoff }).expect(401);
    });

    it('refuses a provider account whose email differs from the one on the form', async () => {
      const { pendingToken } = await registerCaregiver(`typed${Date.now()}@example.com`);
      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: pendingToken }).expect(302);
      expect(new URL(cb.headers.location).searchParams.get('error')).toBe('email_mismatch');
    });

    it('does not offer a provider that has been switched off, and a stale link fails safely', async () => {
      const { pendingToken } = await registerCaregiver();
      await saveProvider('google', { enabled: false }).expect(200);

      expect((await api().get('/auth/social/providers')).body.GOOGLE).toBe(false);
      await api().get('/auth/social/google/authorize-url').query({ token: pendingToken }).expect(400);
      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: pendingToken }).expect(302);
      expect(new URL(cb.headers.location).searchParams.get('error')).toBe('provider_error');

      await saveProvider('google', { enabled: true }).expect(200); // credentials were kept
    });

    it('rejects a callback without a state, or for an unknown provider, with a redirect not a 500', async () => {
      const a = await api().get('/auth/social/google/callback').query({ code: 'c' }).expect(302);
      expect(new URL(a.headers.location).searchParams.get('error')).toBe('invalid_request');
      const b = await api().get('/auth/social/twitter/callback').query({ code: 'c', state: 'x' }).expect(302);
      expect(new URL(b.headers.location).pathname).toBe('/caregiver/social/callback');
    });
  });

  describe('signing in again with a linked provider', () => {
    let profile: Profile;
    let userId: string;

    beforeAll(async () => {
      googleProfile = { sub: `g-return-${Date.now()}`, email: `returning${Date.now()}@example.com` };
      profile = googleProfile;
      const { pendingToken } = await registerCaregiver();
      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: pendingToken }).expect(302);
      const tokens = (await api().post('/auth/social/exchange').send({ code: new URL(cb.headers.location).searchParams.get('code') }).expect(201)).body;
      userId = decodeJwt(tokens.accessToken).sub;
    });

    it('signs a linked caregiver in, bound to the browser nonce', async () => {
      googleProfile = profile;
      const n = nonce();
      const url = (await api().get('/auth/social/google/login-url').query({ nonce: n }).expect(200)).body.url as string;

      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: stateOf(url) }).expect(302);
      const landing = new URL(cb.headers.location);
      expect(landing.searchParams.get('flow')).toBe('login');
      expect(landing.searchParams.get('nonce')).toBe(n);

      const tokens = (await api().post('/auth/social/exchange').send({ code: landing.searchParams.get('code') }).expect(201)).body;
      expect(decodeJwt(tokens.accessToken).sub).toBe(userId);
    });

    it('sends a provider account nobody linked to registration, and creates nothing', async () => {
      googleProfile = { sub: `g-stranger-${Date.now()}`, email: `stranger${Date.now()}@example.com` };
      const url = (await api().get('/auth/social/google/login-url').query({ nonce: nonce() }).expect(200)).body.url as string;

      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: stateOf(url) }).expect(302);
      const landing = new URL(cb.headers.location);
      expect(landing.searchParams.get('error')).toBe('not_registered');
      expect(landing.searchParams.get('flow')).toBe('login');
      expect(await db.select().from(socialAccounts).where(eq(socialAccounts.providerAccountId, googleProfile.sub))).toHaveLength(0);
      expect(await db.select().from(users).where(eq(users.email, googleProfile.email))).toHaveLength(0);
    });

    it('refuses a disabled account even though the provider vouches for it', async () => {
      googleProfile = profile;
      await db.execute(sql`UPDATE users SET is_active = 0 WHERE id = ${userId}`);
      try {
        const url = (await api().get('/auth/social/google/login-url').query({ nonce: nonce() }).expect(200)).body.url as string;
        const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: stateOf(url) }).expect(302);
        expect(new URL(cb.headers.location).searchParams.get('error')).toBe('account_disabled');
      } finally {
        await db.execute(sql`UPDATE users SET is_active = 1 WHERE id = ${userId}`);
      }
    });

    it('rejects a malformed nonce and a registration token used as a login state', async () => {
      await api().get('/auth/social/google/login-url').query({ nonce: 'short' }).expect(400);
      const { pendingToken } = await registerCaregiver();
      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: pendingToken }).expect(302);
      // Treated as a registration (and linked to that registration), never as a sign-in.
      expect(new URL(cb.headers.location).searchParams.get('flow')).toBeNull();
    });

    it('turns a provider rejection into a redirect carrying a short code', async () => {
      googleProfile = profile;
      tokenReply = { status: 400, body: { error: 'invalid_grant', error_description: 'secret=GOCSPX-e2e-secret-value' } };
      const url = (await api().get('/auth/social/google/login-url').query({ nonce: nonce() }).expect(200)).body.url as string;
      const cb = await api().get('/auth/social/google/callback').query({ code: 'c', state: stateOf(url) }).expect(302);
      expect(cb.headers.location).not.toContain('GOCSPX');
      expect(new URL(cb.headers.location).searchParams.get('error')).toBe('provider_error');
    });
  });
});
