/**
 * Google Analytics 4, configured in Settings > Analytics. One definition shared
 * by the API (which validates and stores it), the admin form (which checks it
 * as the admin types) and the public site (which loads gtag.js and reports page
 * views), so what counts as a valid measurement ID - and which pages are
 * measured - cannot drift between them.
 *
 * Only the public, signed-out pages of the public site are measured: the
 * landing page, search, caregiver profiles and the sign-in / sign-up pages (so
 * the sign-up funnel can be followed). Never the staff app, and never a
 * client's or caregiver's own account area, which hold care, booking and
 * payment details. Query strings and #fragments are never sent: a search like
 * "?q=dementia care for my mother" is health information, and Google's terms
 * forbid sending personal data to Analytics.
 */

/** "G-" and the letters/digits GA4 shows under Admin > Data streams, e.g. G-AB12CD34EF. */
export const GA_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,15}$/;

/** What every visitor's browser is told. GET /analytics. */
export interface PublicAnalyticsConfig {
  /** True only when switched on AND a valid measurement ID is set. */
  enabled: boolean;
  measurementId: string | null;
}

export const DISABLED_ANALYTICS: PublicAnalyticsConfig = { enabled: false, measurementId: null };

/**
 * What an admin pasted -> the canonical "G-XXXXXXXXXX", or null. Accepts the
 * bare ID in any case, or the whole Google tag snippet (gtag/js?id=G-… or
 * gtag('config', 'G-…')).
 */
export function normalizeMeasurementId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  if (!v) return null;
  const bare = v.toUpperCase();
  if (GA_MEASUREMENT_ID_RE.test(bare)) return bare;
  // A pasted snippet: take the ID from ?id=G-… or from the config call.
  const match = v.match(/[?&]id=(G-[A-Za-z0-9]+)/) ?? v.match(/config['"]?\s*,\s*['"](G-[A-Za-z0-9]+)['"]/);
  const id = match?.[1]?.toUpperCase();
  return id && GA_MEASUREMENT_ID_RE.test(id) ? id : null;
}

/** The path alone - no query string, no #fragment, no trailing slash. */
export function cleanAnalyticsPath(pathname: string): string {
  return pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

const MEASURED_EXACT = new Set([
  '/',
  '/find',
  '/login',
  '/login/whatsapp',
  '/register',
  '/register/whatsapp',
  '/verify-email',
  '/caregiver/join',
  '/caregiver/signup',
  '/caregiver/login',
  '/caregiver/login/whatsapp',
  '/caregiver/register',
  '/caregiver/register/whatsapp',
]);

/**
 * The pages measured. An allow-list, so a page added later stays unmeasured
 * until someone decides otherwise. Account pages (/account/…), the caregiver
 * portal (/caregiver/dashboard, …), the claim link and the social sign-in
 * callback are deliberately left out.
 */
export function analyticsAllowedOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = cleanAnalyticsPath(pathname);
  return MEASURED_EXACT.has(path) || /^\/caregivers\/[^/]+$/.test(path);
}

/**
 * Anything claimed to be the analytics config -> a usable one. Read from the
 * network on every page load; anything malformed means "no analytics" rather
 * than a broken or foreign tag.
 */
export function normalizeAnalyticsConfig(raw: unknown): PublicAnalyticsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PublicAnalyticsConfig, unknown>>;
  const measurementId =
    typeof r.measurementId === 'string' && GA_MEASUREMENT_ID_RE.test(r.measurementId) ? r.measurementId : null;
  return r.enabled === true && measurementId ? { enabled: true, measurementId } : DISABLED_ANALYTICS;
}
