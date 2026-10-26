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

/** An absolute URL for a public API path - for an <img src> such as a shared profile photo. */
export const apiUrl = (path: string) => `${API_URL}${path}`;
const TOKEN_KEY = 'care-platform-patient-tokens';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export function getStoredTokens(): Tokens | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens: Tokens) {
  window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  window.localStorage.removeItem(TOKEN_KEY);
}

/**
 * The language the visitor chose in the language switcher, sent on every call so
 * the API answers - errors included - in that language. Read per request from
 * the same place the switcher persists it, so a change applies immediately
 * without any state being threaded through.
 */
const LOCALE_STORAGE_KEY = 'care-platform-public-locale';
function currentLanguage(): string {
  try {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'si' || stored === 'ta' ? stored : 'en';
  } catch {
    return 'en';
  }
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

/**
 * Fired when the session is over - the refresh token was refused (expired
 * after 7 days, revoked by signing out elsewhere or by staff). AuthProvider
 * listens and signs the visitor out, so pages stop showing them as signed in
 * and offer sign-in instead. Before this, the page kept showing them signed
 * in from the stored (dead) tokens, and every action failed with a bare
 * "Unauthorized".
 */
export const SESSION_EXPIRED_EVENT = 'care-platform:session-expired';

const SESSION_EXPIRED_MESSAGE: Record<string, string> = {
  en: 'Your session has expired. Please sign in again.',
  si: 'ඔබගේ සැසිය කල් ඉකුත් වී ඇත. කරුණාකර නැවත පුරනය වන්න.',
  ta: 'உங்கள் அமர்வு காலாவதியாகிவிட்டது. மீண்டும் உள்நுழையவும்.',
};

/**
 * A request was refused because the visitor's session has ended. An ApiError
 * (401), so every screen that shows an API error shows this message - in the
 * visitor's language - instead of "Unauthorized".
 */
export class SessionExpiredError extends ApiError {
  constructor() {
    super(401, SESSION_EXPIRED_MESSAGE[currentLanguage()] ?? SESSION_EXPIRED_MESSAGE.en);
  }
}

const SESSION_CHECK_FAILED_MESSAGE: Record<string, string> = {
  en: "We couldn't confirm you're signed in. Please check your connection and try again.",
  si: 'ඔබ පුරනය වී ඇති බව තහවුරු කළ නොහැකි විය. කරුණාකර ඔබේ සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
  ta: 'நீங்கள் உள்நுழைந்துள்ளீர்கள் என்பதை உறுதிப்படுத்த முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
};

/**
 * The access token was refused and the refresh could not be completed for a
 * reason that says nothing about the session - offline, a server error, the
 * rate limit. The session is kept (it may well be fine), but the visitor is
 * told what happened instead of the API's bare "Unauthorized".
 */
export class SessionCheckFailedError extends ApiError {
  constructor() {
    super(401, SESSION_CHECK_FAILED_MESSAGE[currentLanguage()] ?? SESSION_CHECK_FAILED_MESSAGE.en);
  }
}

/**
 * Trades the stored refresh token for a new pair. Returns null when there is
 * no session to refresh any more.
 *
 * Refresh tokens are single use, so two tabs refreshing at once race: the
 * second is refused because the first already rotated the token. A refused
 * refresh therefore looks at storage again before giving up - if another tab
 * has stored a newer pair, that pair is used and the session goes on.
 */
async function refreshStoredTokens(): Promise<Tokens | null> {
  const current = getStoredTokens();
  if (!current) return null;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': currentLanguage() },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
  } catch {
    // Offline or the API is unreachable: the session may be fine, keep it.
    return null;
  }
  if (res.ok) {
    const tokens = (await res.json()) as Tokens;
    storeTokens(tokens);
    return tokens;
  }
  const latest = getStoredTokens();
  if (latest && latest.refreshToken !== current.refreshToken) return latest;
  if (res.status === 401 || res.status === 403) {
    clearTokens();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  return null;
}

/** Refreshes once for every caller waiting at the same time. */
export function refreshSession(): Promise<Tokens | null> {
  if (!refreshPromise) refreshPromise = refreshStoredTokens().finally(() => (refreshPromise = null));
  return refreshPromise;
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

  // A FormData body (a file upload) must not get a JSON content type: the
  // browser has to set multipart/form-data itself, boundary included.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const doFetch = async (accessToken: string | undefined) => {
    const headers: Record<string, string> = isForm ? {} : { 'Content-Type': 'application/json' };
    headers['Accept-Language'] = currentLanguage();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(url, {
      method,
      headers,
      body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch(tokens?.accessToken);

  if (res.status === 401 && tokens) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch(refreshed.accessToken);
    } else if (!getStoredTokens()) {
      // The session is over: say so, rather than the API's bare "Unauthorized".
      throw new SessionExpiredError();
    } else {
      // Could not refresh, but not because the session ended.
      throw new SessionCheckFailedError();
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
  put: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  patch: <T,>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T,>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/**
 * Fetches a protected file (a caregiver's own document) as a Blob.
 *
 * Not `apiRequest`: that parses JSON, and a plain link cannot be used because
 * the file route needs the Authorization header, which a link cannot send.
 * Retries once through the same token refresh as every other call.
 */
export async function fetchBlob(path: string): Promise<Blob> {
  const send = (token?: string) =>
    fetch(`${API_URL}${path}`, {
      headers: { 'Accept-Language': currentLanguage(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  const tokens = getStoredTokens();
  let res = await send(tokens?.accessToken);
  if (res.status === 401 && tokens) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send(refreshed.accessToken);
    else if (!getStoredTokens()) throw new SessionExpiredError();
    else throw new SessionCheckFailedError();
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

export { API_URL };
