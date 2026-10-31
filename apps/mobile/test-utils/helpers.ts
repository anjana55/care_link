import type { Tokens } from '@care-platform/shared';
import type { TokenStore } from '@/api/token-store';

/** An unsigned JWT-shaped token: the app only decodes tokens; the API verifies them. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

export function tokensFor(
  role: string,
  { expiresInSeconds = 900, sub = 'u-1', ...extra }: { expiresInSeconds?: number; sub?: string } & Record<string, unknown> = {},
): Tokens {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return { accessToken: fakeJwt({ sub, email: null, role, exp, ...extra }), refreshToken: `refresh-${sub}-${exp}` };
}

/** A TokenStore in memory, with a record of what was written. */
export function memoryTokens(initial: Tokens | null = null): TokenStore & { saved: Tokens | null } {
  const store = {
    saved: initial,
    load: async () => store.saved,
    get: () => store.saved,
    set: async (t: Tokens) => void (store.saved = t),
    clear: async () => void (store.saved = null),
  };
  return store;
}

/** A Response the way fetch would return one. */
export function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
