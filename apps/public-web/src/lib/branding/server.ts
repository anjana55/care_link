import { DEFAULT_BRANDING, normalizeBranding, type PublicBranding } from '@care-platform/shared';

/**
 * The branding for server rendering - the first paint's colours, the tab title
 * and the favicon - fetched from the API over the internal network
 * (API_INTERNAL_URL; in Docker the `api` service). The browser's own copy
 * (BrandingProvider) takes over after hydration, so a change made in
 * Settings > Branding shows at once even while this cached copy is stale.
 *
 * Never throws: when the API is unreachable (at build time, or while it is
 * still starting) the page renders with the shipped defaults.
 */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export async function getBranding(): Promise<PublicBranding> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/branding`, {
      next: { revalidate: 30, tags: ['branding'] },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return DEFAULT_BRANDING;
    return normalizeBranding(await res.json());
  } catch {
    return DEFAULT_BRANDING;
  }
}
