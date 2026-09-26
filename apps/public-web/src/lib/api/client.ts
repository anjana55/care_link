const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
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

interface RequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Most calls in this app hit a `@Public()` route (anonymous search), so an
 * access token is attached only when one is on hand - it's never required.
 * Once attached, a 401 triggers a single refresh-and-retry, same as
 * apps/web's client, so a signed-in patient/guardian's session survives an
 * expired access token without an extra round trip through /login.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;
  const tokens = getStoredTokens();

  const doFetch = async (accessToken: string | undefined) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(`${API_URL}${path}`, {
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
  get: <T,>(path: string) => apiRequest<T>(path),
  post: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
};

export { API_URL };
