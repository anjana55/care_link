/**
 * App links (Android, for now): a link to the website - in an email, a
 * WhatsApp message or a text - opens the app when it's installed, at the
 * screen that shows the same thing.
 *
 * Android hands the app only links whose path starts with one of
 * APP_LINK_PATHS (in app.config.ts, as the app's intent filters), and
 * only once the website vouches for the app (/.well-known/assetlinks.json,
 * from Settings > Mobile app). Everything else - verifying an email,
 * resetting a password, the social sign-in return, deleting an account,
 * registering - stays on the website, where those pages live.
 */

/** Website page -> app screen. */
const SCREENS: [RegExp, string][] = [
  [/^\/account$/, '/account'],
  [/^\/account\/sign-in$/, '/account'],
  [/^\/account\/bookings$/, '/bookings'],
  [/^\/account\/requests$/, '/requests'],
  [/^\/account\/saved$/, '/saved'],
  [/^\/account\/invoices$/, '/invoices'],
  [/^\/caregiver\/dashboard$/, '/home'],
  [/^\/caregiver\/shifts$/, '/shifts'],
  [/^\/caregiver\/payments$/, '/payments'],
  [/^\/caregiver\/documents$/, '/documents'],
  [/^\/caregiver\/profile$/, '/profile'],
  [/^\/caregiver\/ratings$/, '/ratings'],
  [/^\/find$/, '/find'],
];
/** An invoice: ids are uuids, so nothing else gets through. */
const INVOICE = /^\/account\/invoices\/([0-9a-fA-F-]{36})$/;
/** Rating a caregiver on a booking (the link in "How was your care?"). */
const RATE = /^\/account\/bookings\/([0-9a-fA-F-]{36})\/rate\/([A-Za-z0-9_-]{1,36})$/;
/** A caregiver's public profile. */
const PROFILE = /^\/caregivers\/([A-Za-z0-9_-]{1,64})$/;

/**
 * The app screen for a website path (without its query: the app's screens
 * don't read the website's). A path the app has no screen for opens the
 * app's start, which takes a signed-in person to their area.
 */
export function appScreenFor(path: string): string {
  const p = path.replace(/\/+$/, '') || '/';
  const invoice = INVOICE.exec(p);
  if (invoice) return `/invoices/${invoice[1].toLowerCase()}`;
  const rate = RATE.exec(p);
  if (rate) return `/bookings/${rate[1].toLowerCase()}/rate/${rate[2]}`;
  const profile = PROFILE.exec(p);
  if (profile) return `/caregivers/${profile[1]}`;
  return SCREENS.find(([re]) => re.test(p))?.[1] ?? '/';
}

/**
 * What the app does with an address the phone opened it with. A link to the
 * website (https, on `siteHost`) becomes the matching screen; anything else -
 * the app's own carelink:// addresses, such as the social sign-in return - is
 * left as it came.
 */
export function routeForIncoming(url: string, siteHost: string | null | undefined): string {
  if (!siteHost) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== siteHost.toLowerCase()) return url;
  return appScreenFor(u.pathname);
}
