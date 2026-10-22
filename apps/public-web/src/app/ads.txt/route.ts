import { adsTxtLine } from '@care-platform/shared';
import { getAdsConfig } from '@/lib/ads/server';

/**
 * /ads.txt - the line AdSense asks every site to publish at its root, so ad
 * buyers can check the inventory is really this publisher's. Built from
 * Settings > Ads; there is no file for an operator to upload. Nginx sends "/"
 * (and so /ads.txt) to this app.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const ads = await getAdsConfig();
  if (!ads.enabled || !ads.publisherId) {
    return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return new Response(`${adsTxtLine(ads.publisherId)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
