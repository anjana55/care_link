import { createApiClient } from '@/api/client';
import { ApiError, NetworkError, SessionCheckFailedError, SessionExpiredError } from '@/api/errors';
import { json, memoryTokens, tokensFor } from '../test-utils/helpers';

const BASE = 'https://api.test';

function setup({ signedIn = true, language = 'en' as 'en' | 'si' | 'ta' } = {}) {
  const tokens = memoryTokens(signedIn ? tokensFor('CAREGIVER') : null);
  const onSessionExpired = jest.fn();
  const fetch = jest.fn<Promise<Response>, [string, RequestInit]>();
  const api = createApiClient({ baseUrl: BASE, tokens, language: () => language, onSessionExpired, fetch: fetch as never });
  return { api, tokens, fetch, onSessionExpired };
}

const header = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('API client', () => {
  it('sends the reader’s language and the access token', async () => {
    const { api, fetch, tokens } = setup({ language: 'ta' });
    fetch.mockResolvedValue(json(200, { ok: true }));

    await expect(api.get('/me/shifts', { from: '2026-11-01', empty: '', missing: undefined })).resolves.toEqual({ ok: true });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${BASE}/me/shifts?from=2026-11-01`);
    expect(header(init, 'Accept-Language')).toBe('ta');
    expect(header(init, 'Authorization')).toBe(`Bearer ${tokens.saved!.accessToken}`);
  });

  it('leaves the token off sign-in calls', async () => {
    const { api, fetch } = setup();
    fetch.mockResolvedValue(json(200, {}));
    await api.post('/auth/login', { email: 'a@b.lk' }, { anonymous: true });
    expect(header(fetch.mock.calls[0][1], 'Authorization')).toBeUndefined();
  });

  it('refreshes once for every request that hit an expired token, then retries them', async () => {
    const { api, fetch, tokens } = setup();
    const fresh = tokensFor('CAREGIVER', { sub: 'u-1', expiresInSeconds: 1800 });
    fetch.mockImplementation(async (url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, fresh);
      return header(init, 'Authorization') === `Bearer ${fresh.accessToken}` ? json(200, { url }) : json(401, { message: 'Unauthorized' });
    });

    const results = await Promise.all([api.get('/me/shifts'), api.get('/me/payouts'), api.get('/me/care')]);

    expect(results).toHaveLength(3);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(tokens.saved).toEqual(fresh);
  });

  it('ends the session when the refresh is refused, and says so in the reader’s language', async () => {
    const { api, fetch, tokens, onSessionExpired } = setup({ language: 'si' });
    fetch.mockImplementation(async () => json(401, { message: 'Unauthorized' }));

    const error = await api.get<never>('/me/shifts').catch((e: unknown) => e as ApiError);

    expect(error).toBeInstanceOf(SessionExpiredError);
    expect(error.message).toMatch(/සැසිය/);
    expect(tokens.saved).toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails for want of a connection', async () => {
    const { api, fetch, tokens, onSessionExpired } = setup();
    const before = tokens.saved;
    fetch.mockImplementation(async (url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('Network request failed');
      return json(401, {});
    });

    await expect(api.get('/me/shifts')).rejects.toBeInstanceOf(SessionCheckFailedError);
    expect(tokens.saved).toBe(before);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('passes the API’s own error message through', async () => {
    const { api, fetch } = setup();
    fetch.mockResolvedValue(json(400, { message: ['phone must be valid', 'name is required'] }));
    const error = await api.post<never>('/x', {}).catch((e: unknown) => e as ApiError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('phone must be valid, name is required');
  });

  it('reports no connection as a NetworkError, not an API error', async () => {
    const { api, fetch } = setup({ signedIn: false });
    fetch.mockRejectedValue(new TypeError('Network request failed'));
    await expect(api.get('/branding')).rejects.toBeInstanceOf(NetworkError);
  });
});
