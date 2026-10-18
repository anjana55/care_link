/**
 * Where to send a client after they sign in or finish signing up, when they
 * left a page to do it - "Contact this caregiver" on a profile sends them to
 * register, and they should land back on that profile, not on the home page.
 *
 * localStorage rather than sessionStorage: email sign-up finishes in whatever
 * tab the verification link opens, which is a new one. The entry expires so a
 * stale one can't hijack a sign-in days later, and only same-site paths are
 * ever accepted, so it can't be turned into an open redirect.
 */
const KEY = 'care-platform-return-to';
const MAX_AGE_MS = 60 * 60 * 1000;

const isSafePath = (path: string) => path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');

export function rememberReturnTo(path: string) {
  if (!isSafePath(path)) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // Storage blocked (private mode): the visitor just lands on the default page.
  }
}

/** Returns and forgets the remembered path, or `fallback`. */
export function takeReturnTo(fallback: string): string {
  try {
    const raw = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    if (!raw) return fallback;
    const { path, at } = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof path !== 'string' || typeof at !== 'number' || Date.now() - at > MAX_AGE_MS || !isSafePath(path)) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
