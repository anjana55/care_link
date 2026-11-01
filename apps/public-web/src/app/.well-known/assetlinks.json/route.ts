import { assetLinksFor, type AndroidAppLinks } from '@care-platform/shared';

/**
 * /.well-known/assetlinks.json - the website vouching for the Android app, so
 * a link to this site (in an email, a WhatsApp message) opens the app when
 * it's installed. Android reads it when the app is installed or updated.
 *
 * The app's package and signing fingerprints are set in the staff app under
 * Settings > Mobile app and come from the API over the internal network. Only
 * the package and fingerprints are taken from its answer and the file is
 * rebuilt here, so it is always well-formed. When the API can't be reached or
 * nothing is set, the site vouches for no app ([]) and links stay in the
 * browser - nothing breaks.
 */
export const dynamic = 'force-dynamic';

const API_INTERNAL_URL = (process.env.API_INTERNAL_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/** The package and fingerprints in the API's answer, or nothing. */
function linksIn(body: unknown): AndroidAppLinks | null {
  const target = Array.isArray(body) ? (body[0] as { target?: unknown } | undefined)?.target : null;
  if (!target || typeof target !== 'object') return null;
  const t = target as { package_name?: unknown; sha256_cert_fingerprints?: unknown };
  return {
    packageName: typeof t.package_name === 'string' ? t.package_name : null,
    certFingerprints: Array.isArray(t.sha256_cert_fingerprints) ? t.sha256_cert_fingerprints.filter((f): f is string => typeof f === 'string') : [],
  };
}

export async function GET() {
  let links: AndroidAppLinks | null = null;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/public/app-links/android`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (res.ok) links = linksIn(await res.json());
  } catch {
    links = null;
  }
  return Response.json(assetLinksFor(links), {
    // Android doesn't re-read it often; a few minutes keeps a change in Settings quick to show.
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
