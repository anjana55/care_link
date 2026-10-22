import { DISABLED_ANALYTICS, normalizeAnalyticsConfig, type PublicAnalyticsConfig } from '@care-platform/shared';

/**
 * The Google Analytics config (Settings > Analytics) for server rendering,
 * fetched from the API over the internal network like the branding and ads.
 *
 * Never throws: when the API is unreachable (at build time, or while it is
 * still starting) the site renders with no analytics at all.
 */
const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

export async function getAnalyticsConfig(): Promise<PublicAnalyticsConfig> {
  try {
    const res = await fetch(`${API_INTERNAL_URL}/analytics`, {
      next: { revalidate: 30, tags: ['analytics'] },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return DISABLED_ANALYTICS;
    return normalizeAnalyticsConfig(await res.json());
  } catch {
    return DISABLED_ANALYTICS;
  }
}
