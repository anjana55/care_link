import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import type { SocialProviderAvailability, Tokens } from '@care-platform/shared';
import { api, ApiError } from '@/api';
import { hasNativeModule } from '@/native';
import type { Side } from './sides';

export type SocialProvider = 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';
export const SOCIAL_ORDER: SocialProvider[] = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'];

/**
 * What came of a Google, Microsoft or Facebook sign-in: a session, the person
 * closing the browser, or a reason - one of the API's codes (`not_registered`,
 * `wrong_portal`, `declined`, `expired`, ...) or the app's own
 * (`state_mismatch`, `exchange_failed`, `unsupported`).
 */
export type SocialOutcome = { tokens: Tokens } | { canceled: true } | { error: string };

type WebBrowser = typeof import('expo-web-browser');
type Crypto = typeof import('expo-crypto');

/** The phone side: random bytes, SHA-256 and the sign-in browser. Swapped for stand-ins in tests. */
export interface SocialDeps {
  randomBytes(count: number): Uint8Array;
  sha256Base64(text: string): Promise<string>;
  openAuthSession(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
  redirectUrl: string;
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64url, no padding, of some bytes. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += base64Alphabet[(n >> 18) & 63] + base64Alphabet[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += base64Alphabet[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += base64Alphabet[n & 63];
  }
  return toBase64Url(out);
}
export const toBase64Url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function load<T>(nativeName: string, pkg: () => T): T | null {
  if (!hasNativeModule(nativeName)) return null;
  try {
    return pkg();
  } catch {
    return null;
  }
}

/**
 * The real thing, or null in a build made before expo-web-browser and
 * expo-crypto were added: the buttons then don't show.
 */
export function phoneSocialDeps(): SocialDeps | null {
  const browser = load<WebBrowser>('ExpoWebBrowser', () => require('expo-web-browser'));
  const crypto = load<Crypto>('ExpoCrypto', () => require('expo-crypto'));
  if (!browser || !crypto) return null;
  return {
    randomBytes: (n) => crypto.getRandomBytes(n),
    sha256Base64: (text) => crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text, { encoding: crypto.CryptoEncoding.BASE64 }),
    openAuthSession: (url, redirect) => browser.openAuthSessionAsync(url, redirect),
    // The API sends the result here (its MOBILE_APP_SCHEME, which is this app's scheme).
    redirectUrl: `${Constants.expoConfig?.scheme ?? 'carelink'}://auth/callback`,
  };
}

/** Which providers this deployment has switched on - none on a build that can't sign in with them. */
export function useSocialProviders(deps: SocialDeps | null) {
  return useQuery({
    queryKey: ['social-providers'],
    queryFn: () => api.request<SocialProviderAvailability>('/auth/social/providers', { anonymous: true }),
    enabled: deps !== null,
    staleTime: 5 * 60_000,
    select: (p) => SOCIAL_ORDER.filter((name) => p[name]),
  });
}

/**
 * Signs in with Google, Microsoft or Facebook, on one side of the app.
 *
 * The provider's page opens in the phone's sign-in browser. The API sends the
 * result back to this app's scheme with a one-time code, which another app
 * claiming the same scheme could catch - so the code was bound, when the
 * sign-in started, to a challenge whose secret (the verifier) never leaves
 * this phone, and the exchange presents it (as OAuth's PKCE). The nonce, as on
 * the website, ties the result to the attempt this phone started.
 */
export async function signInWithProvider(provider: SocialProvider, side: Side, deps: SocialDeps): Promise<SocialOutcome> {
  const nonce = hex(deps.randomBytes(16));
  const verifier = bytesToBase64Url(deps.randomBytes(32));
  const challenge = toBase64Url(await deps.sha256Base64(verifier));

  let url: string;
  try {
    ({ url } = await api.request<{ url: string }>(`/auth/social/${provider.toLowerCase()}/login-url`, {
      params: { nonce, side, client: 'app', challenge },
      anonymous: true,
    }));
  } catch (err) {
    return { error: err instanceof ApiError ? 'provider_error' : 'network' };
  }

  const result = await deps.openAuthSession(url, deps.redirectUrl);
  if (result.type !== 'success' || !result.url) return { canceled: true };

  const back = new URL(result.url);
  const failure = back.searchParams.get('error');
  if (failure) return failure === 'declined' ? { canceled: true } : { error: failure };
  if (back.searchParams.get('nonce') !== nonce) return { error: 'state_mismatch' };
  const code = back.searchParams.get('code');
  if (!code) return { error: 'invalid_request' };

  try {
    const tokens = await api.request<Tokens>('/auth/social/exchange', { method: 'POST', body: { code, verifier }, anonymous: true });
    return { tokens };
  } catch {
    return { error: 'exchange_failed' };
  }
}
