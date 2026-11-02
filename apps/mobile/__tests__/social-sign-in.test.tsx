import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import en from '../src/i18n/en.json';
import SignIn from '../app/(auth)/sign-in';
import AuthCallback from '../app/auth/callback';
import { bytesToBase64Url, signInWithProvider, type SocialDeps } from '../src/auth/social';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

/**
 * Google, Microsoft and Facebook sign-in in the app. The phone's sign-in
 * browser and crypto are stand-ins (the SHA-256 is Node's real one, so the
 * challenge is checked for real); the API is recorded calls.
 */

const nodeCrypto = require('crypto') as {
  createHash(a: string): { update(s: string): { digest(e: string): string } };
  randomBytes(n: number): Uint8Array;
};
const { Buffer } = require('buffer') as { Buffer: { from(b: Uint8Array): { toString(e: string): string } } };
const sha256Base64url = (s: string) => nodeCrypto.createHash('sha256').update(s).digest('base64url');

/** A phone whose browser returns `answer(loginUrl)` as the result address. */
function phone(answer: (url: string) => { type: string; url?: string }): SocialDeps & { opened: { url: string; redirect: string }[] } {
  const opened: { url: string; redirect: string }[] = [];
  return {
    opened,
    randomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    sha256Base64: async (s) => nodeCrypto.createHash('sha256').update(s).digest('base64'),
    openAuthSession: async (url, redirect) => {
      opened.push({ url, redirect });
      return answer(url);
    },
    redirectUrl: 'carelink://auth/callback',
  };
}
/** The API's redirect back to the app after a sign-in, echoing the attempt's nonce. */
const backToApp = (loginUrl: string, params: Record<string, string>) => {
  const nonce = new URL(loginUrl).searchParams.get('nonce')!;
  return { type: 'success', url: `carelink://auth/callback?${new URLSearchParams({ flow: 'login', nonce, ...params })}` };
};
const LOGIN_URL = 'GET /auth/social/google/login-url';

beforeEach(() => mockRouter.reset());

describe('signing in with a provider', () => {
  it('binds the code to a secret only this phone holds, and exchanges it with that secret', async () => {
    const tokens = tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' });
    const calls = serveApi({
      [LOGIN_URL]: (_b, q) => ({ status: 200, body: { url: `https://accounts.google.com/o?${new URLSearchParams(q)}` } }),
      'POST /auth/social/exchange': () => ({ status: 200, body: tokens }),
    });
    const deps = phone((url) => backToApp(url, { code: 'c0de' }));

    expect(await signInWithProvider('GOOGLE', 'client', deps)).toEqual({ tokens });

    const start = calls.find((c) => c.route === LOGIN_URL)!;
    expect(start.query).toMatchObject({ side: 'client', client: 'app' });
    expect(start.query.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(start.query.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start.headers.Authorization).toBeUndefined();
    expect(deps.opened[0].redirect).toBe('carelink://auth/callback');

    const exchange = calls.find((c) => c.route === 'POST /auth/social/exchange')!;
    expect(exchange.body.code).toBe('c0de');
    // The verifier sent now is the secret behind the challenge sent at the start.
    expect(sha256Base64url(String(exchange.body.verifier))).toBe(start.query.challenge);
  });

  it('treats a closed browser or "declined" as nothing happening', async () => {
    serveApi({ [LOGIN_URL]: () => ({ status: 200, body: { url: 'https://accounts.google.com/o?x' } }) });
    expect(await signInWithProvider('GOOGLE', 'client', phone(() => ({ type: 'cancel' })))).toEqual({ canceled: true });
    expect(await signInWithProvider('GOOGLE', 'client', phone((u) => backToApp(u, { error: 'declined' })))).toEqual({ canceled: true });
  });

  it("passes on the API's reason, and spends no code it didn't start", async () => {
    const calls = serveApi({ [LOGIN_URL]: () => ({ status: 200, body: { url: 'https://accounts.google.com/o?nonce=x' } }) });
    expect(await signInWithProvider('GOOGLE', 'caregiver', phone((u) => backToApp(u, { error: 'not_registered' })))).toEqual({ error: 'not_registered' });

    // A result for another attempt (its nonce isn't this one's).
    const stranger = { type: 'success', url: 'carelink://auth/callback?flow=login&nonce=someone-else&code=c0de' };
    expect(await signInWithProvider('GOOGLE', 'caregiver', phone(() => stranger))).toEqual({ error: 'state_mismatch' });
    expect(calls.some((c) => c.route === 'POST /auth/social/exchange')).toBe(false);
  });

  it('says so when the code is refused', async () => {
    serveApi({
      [LOGIN_URL]: (_b, q) => ({ status: 200, body: { url: `https://accounts.google.com/o?${new URLSearchParams(q)}` } }),
      'POST /auth/social/exchange': () => ({ status: 401, body: { message: 'This sign-in link has expired. Please try again.' } }),
    });
    expect(await signInWithProvider('GOOGLE', 'client', phone((u) => backToApp(u, { code: 'c0de' })))).toEqual({ error: 'exchange_failed' });
  });

  it('writes base64url the way the API reads it', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(nodeCrypto.randomBytes(n));
      expect(bytesToBase64Url(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    }
  });
});

describe('the sign-in screen', () => {
  const mockDeps: { current: SocialDeps | null } = { current: null };
  beforeAll(() => {
    jest.spyOn(require('../src/auth/social'), 'phoneSocialDeps').mockImplementation(() => mockDeps.current);
  });

  it('offers the providers that are switched on, and signs in with one', async () => {
    const tokens = tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' });
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'GET /auth/social/providers': () => ({ status: 200, body: { GOOGLE: true, MICROSOFT: false, FACEBOOK: true } }),
      [LOGIN_URL]: (_b, q) => ({ status: 200, body: { url: `https://accounts.google.com/o?${new URLSearchParams(q)}` } }),
      'POST /auth/social/exchange': () => ({ status: 200, body: tokens }),
    });
    mockDeps.current = phone((u) => backToApp(u, { code: 'c0de' }));
    mockRouter.params = { role: 'client' };
    await render(<AppProviders><SignIn /></AppProviders>);

    await fireEvent.press(await screen.findByRole('button', { name: en.signIn.social.continue.GOOGLE }));
    expect(screen.getByRole('button', { name: en.signIn.social.continue.FACEBOOK })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.signIn.social.continue.MICROSOFT })).toBeNull();
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/start'));
    expect(tokenStore.get()).toEqual(tokens);
  });

  it("points a caregiver's account to the caregiver sign-in", async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'GET /auth/social/providers': () => ({ status: 200, body: { GOOGLE: true, MICROSOFT: false, FACEBOOK: false } }),
      [LOGIN_URL]: (_b, q) => ({ status: 200, body: { url: `https://accounts.google.com/o?${new URLSearchParams(q)}` } }),
    });
    mockDeps.current = phone((u) => backToApp(u, { error: 'wrong_portal' }));
    mockRouter.params = { role: 'client' };
    await render(<AppProviders><SignIn /></AppProviders>);

    await fireEvent.press(await screen.findByRole('button', { name: en.signIn.social.continue.GOOGLE }));
    expect(await screen.findByText(en.signIn.social.errors.wrongPortalClient)).toBeTruthy();
    await fireEvent.press(screen.getByRole('link', { name: en.signIn.caregiver }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { role: 'caregiver' } });
    expect(tokenStore.get()).toBeNull();
  });

  it('shows no buttons on a build without the sign-in browser, or with no provider on', async () => {
    serveApi({
      'GET /auth/whatsapp/config': () => ({ status: 200, body: { enabled: false } }),
      'GET /auth/social/providers': () => ({ status: 200, body: { GOOGLE: false, MICROSOFT: false, FACEBOOK: false } }),
    });
    mockRouter.params = { role: 'caregiver' };
    mockDeps.current = null;
    const first = await render(<AppProviders><SignIn /></AppProviders>);
    await screen.findByLabelText(en.signIn.email);
    expect(screen.queryByText(en.signIn.social.orEmail)).toBeNull();
    await first.unmount();

    mockDeps.current = phone(() => ({ type: 'cancel' }));
    await render(<AppProviders><SignIn /></AppProviders>);
    await screen.findByLabelText(en.signIn.email);
    await waitFor(() => expect(screen.queryByText(en.signIn.social.orEmail)).toBeNull());
  });
});

it('the return address steps back to the waiting sign-in screen', async () => {
  (mockRouter as unknown as { canGoBack: jest.Mock }).canGoBack = jest.fn(() => true);
  await render(<AppProviders><AuthCallback /></AppProviders>);
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});
