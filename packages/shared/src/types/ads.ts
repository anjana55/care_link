/**
 * Google AdSense, configured in Settings > Ads. One definition shared by the
 * API (which validates and stores it), the admin form (which checks it as the
 * admin types) and the public site (which loads the AdSense script and draws
 * the ad units), so what counts as a valid publisher ID - and which pages may
 * carry ads - cannot drift between them.
 *
 * Ads only ever appear on the public, signed-out marketing and search pages of
 * the public site. Never in the staff app, never on sign-in or registration
 * pages, and never in a client's or caregiver's own account area: AdSense does
 * not allow ads on login screens, and those pages hold care and payment details.
 */

/** Where a manually placed ad unit can go on the public site. */
export const AD_PLACEMENTS = ['home', 'search', 'profile'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** "ca-pub-" and 16 digits, as AdSense shows it under Account > Account information. */
export const ADSENSE_PUBLISHER_ID_RE = /^ca-pub-\d{16}$/;
/** An ad unit's data-ad-slot: digits only (AdSense issues 10). */
export const ADSENSE_SLOT_ID_RE = /^\d{6,20}$/;

/** Google's certification authority ID, the same for every AdSense publisher. */
export const ADSENSE_TAG_ID = 'f08c47fec0942fa0';

/** What every visitor's browser is told. GET /ads. */
export interface PublicAdsConfig {
  /** True only when switched on AND a valid publisher ID is set. */
  enabled: boolean;
  publisherId: string | null;
  /** data-ad-slot per placement; null = no manual unit there (Auto ads may still place ads). */
  slots: Record<AdPlacement, string | null>;
}

export const EMPTY_SLOTS: Record<AdPlacement, string | null> = { home: null, search: null, profile: null };

export const DISABLED_ADS: PublicAdsConfig = { enabled: false, publisherId: null, slots: { ...EMPTY_SLOTS } };

/**
 * What an admin pasted -> the canonical "ca-pub-0123456789012345", or null.
 * Accepts the forms AdSense shows in different places: "ca-pub-…", "pub-…",
 * the bare 16 digits, or the whole <script> snippet with ?client=ca-pub-….
 */
export function normalizePublisherId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const match = input.trim().match(/(?:^|[^\d])(?:ca-)?pub-(\d{16})(?!\d)|^(\d{16})$/i);
  const digits = match?.[1] ?? match?.[2];
  return digits ? `ca-pub-${digits}` : null;
}

/** An ad unit's slot ID, trimmed; null when blank or not a slot ID. */
export function normalizeSlotId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.trim();
  return ADSENSE_SLOT_ID_RE.test(v) ? v : null;
}

/**
 * The line AdSense asks every site to publish at /ads.txt, so ad buyers can
 * check the inventory is really this publisher's.
 */
export function adsTxtLine(publisherId: string): string {
  return `google.com, ${publisherId.replace(/^ca-/, '')}, DIRECT, ${ADSENSE_TAG_ID}`;
}

/**
 * The pages ads may appear on. An allow-list, so a page added later stays
 * ad-free until someone decides otherwise: the landing page, the search page
 * and public caregiver profiles.
 */
export function adsAllowedOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return path === '/' || path === '/find' || /^\/caregivers\/[^/]+$/.test(path);
}

/**
 * Anything claimed to be the ads config -> a usable one. Read from the network
 * on every page load; anything malformed means "no ads" rather than a broken
 * or foreign ad tag.
 */
export function normalizeAdsConfig(raw: unknown): PublicAdsConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PublicAdsConfig, unknown>>;
  const publisherId = typeof r.publisherId === 'string' && ADSENSE_PUBLISHER_ID_RE.test(r.publisherId) ? r.publisherId : null;
  const rawSlots = (r.slots && typeof r.slots === 'object' ? r.slots : {}) as Record<string, unknown>;
  const slots = { ...EMPTY_SLOTS };
  for (const p of AD_PLACEMENTS) slots[p] = normalizeSlotId(rawSlots[p]);
  const enabled = r.enabled === true && publisherId !== null;
  return enabled ? { enabled, publisherId, slots } : DISABLED_ADS;
}
