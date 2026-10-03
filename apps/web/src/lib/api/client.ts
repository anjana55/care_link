/**
 * Same-origin by default - see the note in apps/public-web's client.ts.
 * `/api` resolves against whichever host nginx answers on, so the staff
 * portal works from a domain, a LAN IP or localhost alike. Only an absolute
 * value baked in at build time breaks that, because the browser (not the
 * server) is what resolves it.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const TOKEN_KEY = 'care-platform-tokens';

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

async function refreshTokens(): Promise<Tokens | null> {
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
  isFormData?: boolean;
  /** Serialised into the query string, skipping `undefined`/`null`/empty values
   * so a caller can pass something that may not be set without branching. The
   * locations endpoints take all their input this way. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

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

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, isFormData = false, params } = options;
  const url = `${API_URL}${withParams(path, params)}`;
  const tokens = getStoredTokens();

  const doFetch = async (accessToken: string | undefined) => {
    const headers: Record<string, string> = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(url, {
      method,
      headers,
      body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
    });
  };

  let res = await doFetch(tokens?.accessToken);

  if (res.status === 401 && tokens) {
    if (!refreshPromise) refreshPromise = refreshTokens().finally(() => (refreshPromise = null));
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
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return undefined as T;
}

export const api = {
  get: <T,>(path: string, params?: RequestOptions['params']) => apiRequest<T>(path, { params }),
  post: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T,>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
  upload: <T,>(path: string, formData: FormData) => apiRequest<T>(path, { method: 'POST', body: formData, isFormData: true }),
};

export { API_URL };
