/**
 * Same-origin by default.
 *
 * nginx already proxies this app's `/api/` to the API container (see
 * deploy/nginx.conf), so a bare path is all that is needed - and it is the
 * only form that keeps working when the site is reached by any host other
 * than the machine it is deployed on. An absolute value baked in at build
 * time makes the *visitor's* browser resolve it, so `http://localhost/api`
 * points at the visitor's own machine and every call fails. That failure is
 * silent: React Query swallows it, `data` falls back to `[]`, and the
 * district/city dropdowns render as permanently empty with nothing on screen
 * to explain why.
 *
 * Still overridable for split-host deployments where the API genuinely lives
 * elsewhere; those must also add the site's origin to CORS_ORIGIN on the API.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const TOKEN_KEY = 'care-platform-patient-tokens';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function getStoredTokens(): Tokens | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

export function storeTokens(tokens: Tokens) {
  window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let refreshPromise: Promise<Tokens | null> | null = null;

async function refreshStoredTokens(): Promise<Tokens | null> {
  const current = getStoredTokens();
  if (!current) return null;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!res.ok) {
    clearTokens();
    return null;
  }
  const tokens = (await res.json()) as Tokens;
  storeTokens(tokens);
  return tokens;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Serialised into the query string, skipping `undefined`/`null` entries so a
   * caller can pass a value that may not be set without branching at the call
   * site. Needed by the locations endpoints, whose only inputs (`districtId`,
   * `locale`) are query parameters. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

/** Appends `params` to `path` as a query string, dropping empty values. */
function withParams(path: string, params: RequestOptions['params']): string {
  if (!params) return path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/**
 * Most calls in this app hit a `@Public()` route (anonymous search), so an
 * access token is attached only when one is on hand - it's never required.
 * Once attached, a 401 triggers a single refresh-and-retry, same as
 * apps/web's client, so a signed-in patient/guardian's session survives an
 * expired access token without an extra round trip through /login.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params } = options;
  const url = `${API_URL}${withParams(path, params)}`;
  const tokens = getStoredTokens();

  const doFetch = async (accessToken: string | undefined) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch(tokens?.accessToken);

  if (res.status === 401 && tokens) {
    if (!refreshPromise) refreshPromise = refreshStoredTokens().finally(() => (refreshPromise = null));
    const refreshed = await refreshPromise;
    if (refreshed) {
      res = await doFetch(refreshed.accessToken);
    }
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const errBody = await res.json();
      message = errBody.message ?? message;
    } catch {
      /* ignore parse errors */
    }
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : message);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return undefined as T;
}

export const api = {
  get: <T,>(path: string, params?: RequestOptions['params']) => apiRequest<T>(path, { params }),
  post: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
};

export { API_URL };
