/**
 * A full page load, for the places a client-side `router.push` is wrong:
 * leaving the site for a sign-in provider, and starting afresh after signing
 * in or out so no state from the previous session survives.
 *
 * One function rather than `window.location.assign` at each call site so
 * tests can stand in for it: jsdom can't navigate, and since jsdom 26 (Jest
 * 30) `window.location` can no longer be redefined either - browsers forbid
 * it, and jsdom now does too.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
