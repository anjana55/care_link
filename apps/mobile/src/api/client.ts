import type { Locale } from '@care-platform/shared/i18n';
import type { Tokens } from '@care-platform/shared';
import { ApiError, NetworkError, SessionCheckFailedError, SessionExpiredError } from './errors';
import type { TokenStore } from './token-store';

/**
 * The app's API client. Same behaviour as the public site's
 * (apps/public-web/src/lib/api/client.ts):
 *
 * - every request carries the reader's language, so the API answers - errors
 *   included - in English, Sinhala or Tamil;
 * - an access token is attached when there is one, and a 401 triggers a single
 *   refresh-and-retry, shared by every request waiting at the time (refresh
 *   tokens are single use: two parallel refreshes would sign the person out);
 * - when the refresh is refused the session is over: tokens are cleared and
 *   `onSessionExpired` fires, so the app shows the sign-in screen.
 *
 * Built by a factory so tests can give it their own fetch and storage.
 */
export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  language: () => Locale;
  onSessionExpired?: () => void;
  fetch?: typeof fetch;
}

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: QueryParams;
  /** Skip the access token even when signed in (sign-in calls themselves). */
  anonymous?: boolean;
}

function withParams(path: string, params?: QueryParams): string {
  if (!params) return path;
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;
}

export function createApiClient({
  baseUrl,
  tokens,
  language,
  onSessionExpired,
  // Looked up per call, not captured once, so a fetch installed later (a test,
  // a network logger in development) is the one used.
  fetch: fetchImpl = (input, init) => globalThis.fetch(input, init),
}: ApiClientOptions) {
  let refreshing: Promise<Tokens | null> | null = null;

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, init);
    } catch (err) {
      throw new NetworkError(err);
    }
  }

  async function refreshOnce(): Promise<Tokens | null> {
    const current = tokens.get();
    if (!current) return null;
    let res: Response;
    try {
      res = await send(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language() },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
    } catch {
      return null; // offline: the session may be fine, keep it
    }
    if (res.ok) {
      const next = (await res.json()) as Tokens;
      await tokens.set(next);
      return next;
    }
    if (res.status === 401 || res.status === 403) {
      await tokens.clear();
      onSessionExpired?.();
    }
    return null;
  }

  /** Trades the refresh token for a new pair, once for every caller waiting at the same time. */
  function refreshSession(): Promise<Tokens | null> {
    if (!refreshing) refreshing = refreshOnce().finally(() => (refreshing = null));
    return refreshing;
  }

  async function request<T>(path: string, { method = 'GET', body, params, anonymous = false }: RequestOptions = {}): Promise<T> {
    const url = `${baseUrl}${withParams(path, params)}`;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const call = (accessToken?: string) => {
      const headers: Record<string, string> = { 'Accept-Language': language(), Accept: 'application/json' };
      if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      return send(url, {
        method,
        headers,
        body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    const session = anonymous ? null : tokens.get();
    let res = await call(session?.accessToken);

    if (res.status === 401 && session) {
      const refreshed = await refreshSession();
      if (refreshed) res = await call(refreshed.accessToken);
      else if (!tokens.get()) throw new SessionExpiredError(language());
      else throw new SessionCheckFailedError(language());
    }

    if (!res.ok) {
      let message = res.statusText || `Request failed (${res.status})`;
      try {
        const payload = (await res.json()) as { message?: string | string[] };
        if (payload?.message) message = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, message);
    }

    if (res.status === 204) return undefined as T;
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? await res.json() : undefined) as T;
  }

  return {
    request,
    refreshSession,
    get: <T>(path: string, params?: QueryParams) => request<T>(path, { params }),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
