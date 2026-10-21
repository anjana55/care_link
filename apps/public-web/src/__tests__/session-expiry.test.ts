/**
 * "Contact caregiver -> Send request" said "Unauthorized": the visitor's
 * session had ended (refresh token expired or revoked), but the page still
 * showed them signed in from the stored tokens. These pin down what happens
 * now when the API refuses the refresh.
 */
import { api, ApiError, getStoredTokens, SESSION_EXPIRED_EVENT, SessionExpiredError, storeTokens } from '@/lib/api/client';

const TOKEN_KEY = 'care-platform-patient-tokens';

// jsdom has no Response; the client only reads these parts of one.
function respond(status: number, body: unknown = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    headers: { get: () => 'application/json' },
    json: async () => body,
  });
}

describe('a request after the session has ended', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('signs the visitor out and says the session expired, not "Unauthorized"', async () => {
    storeTokens({ accessToken: 'old-access', refreshToken: 'dead-refresh' });
    fetchMock.mockImplementation((url: string) => (String(url).endsWith('/auth/refresh') ? respond(401, { message: 'Invalid refresh token' }) : respond(401, { message: 'Unauthorized' })));
    const expired = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);

    const err = await api.post('/me/care-requests', { caregiverPublicId: 'x' }).catch((e) => e);

    expect(err).toBeInstanceOf(SessionExpiredError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).message).not.toBe('Unauthorized');
    expect(getStoredTokens()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('answers in the visitor\'s language', async () => {
    window.localStorage.setItem('care-platform-public-locale', 'si');
    storeTokens({ accessToken: 'old-access', refreshToken: 'dead-refresh' });
    fetchMock.mockImplementation(() => respond(401));

    const err = (await api.get('/me/care-requests').catch((e) => e)) as ApiError;

    expect(err.message).toMatch(/සැසිය/);
  });

  it('keeps the session when another tab already refreshed it (refresh tokens are single use)', async () => {
    storeTokens({ accessToken: 'old-access', refreshToken: 'used-by-other-tab' });
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) {
        // The other tab wins the race and stores the new pair first.
        window.localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: 'new-access', refreshToken: 'new-refresh' }));
        return respond(401);
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new-access' ? respond(200, { ok: true }) : respond(401);
    });

    await expect(api.get('/me/care-requests')).resolves.toEqual({ ok: true });
    expect(getStoredTokens()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });

  it('keeps the session when the API cannot be reached', async () => {
    storeTokens({ accessToken: 'old-access', refreshToken: 'fine' });
    fetchMock.mockImplementation((url: string) => (String(url).endsWith('/auth/refresh') ? Promise.reject(new TypeError('Failed to fetch')) : respond(401)));

    await expect(api.get('/me/care-requests')).rejects.toBeInstanceOf(ApiError);
    expect(getStoredTokens()).toEqual({ accessToken: 'old-access', refreshToken: 'fine' });
  });
});
