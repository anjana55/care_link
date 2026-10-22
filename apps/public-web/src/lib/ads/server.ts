import { DISABLED_ADS, normalizeAdsConfig, type PublicAdsConfig } from '@care-platform/shared';

/**
 * The Google AdSense config (Settings > Ads) for server rendering, fetched
 * from the API over the internal network like the branding.
 *
 * Never throws: when the API is unreachable (at build time, or while it is
 * still starting) the site renders with no ads at all.
 */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export async function getAdsConfig(): Promise<PublicAdsConfig> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/ads`, {
      next: { revalidate: 30, tags: ['ads'] },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return DISABLED_ADS;
    return normalizeAdsConfig(await res.json());
  } catch {
    return DISABLED_ADS;
  }
}
