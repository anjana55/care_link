/**
 * App links: a link to the website - in an email, a WhatsApp message, a text -
 * opens the app instead, when it is installed. Android only checks that the
 * website vouches for the app: the site publishes, at
 * /.well-known/assetlinks.json, the app's package name and the SHA-256
 * fingerprint of the certificate it is signed with. Both are set by an admin
 * under Settings > Mobile app (the fingerprint is only known once the app is
 * signed for the Play Store) and read here by the API, the admin form and the
 * website, so all three agree on what a valid one is.
 */

/** An Android package name: two or more dot-separated parts, each starting with a letter (com.vivantihealth.carelink). */
export const ANDROID_PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** A SHA-256 certificate fingerprint as Android writes it: 32 bytes in upper-case hex, separated by colons. */
export const CERT_FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** At most this many certificates: the upload key and Play's signing key, with room to rotate. */
export const MAX_CERT_FINGERPRINTS = 5;

export interface AndroidAppLinks {
  /** The app's package name. Null until set. */
  packageName: string | null;
  /** The SHA-256 fingerprints of the certificates the app is signed with. */
  certFingerprints: string[];
}

export const EMPTY_ANDROID_APP_LINKS: AndroidAppLinks = { packageName: null, certFingerprints: [] };

/**
 * One fingerprint as pasted - from Play Console, `keytool` or `eas credentials`:
 * upper or lower case, with colons or without - in Android's form, or null if
 * it isn't one.
 */
export function normalizeCertFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  const pairs = hex.match(/../g)!.join(':');
  return CERT_FINGERPRINT_RE.test(pairs) ? pairs : null;
}

/**
 * The fingerprints in a text box, one per line (or separated by commas or
 * spaces): the valid ones in Android's form, without repeats, and what
 * couldn't be read.
 */
export function parseCertFingerprints(text: string): { fingerprints: string[]; invalid: string[] } {
  const fingerprints: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/).filter(Boolean)) {
    const f = normalizeCertFingerprint(part);
    if (!f) invalid.push(part);
    else if (!fingerprints.includes(f)) fingerprints.push(f);
  }
  return { fingerprints, invalid };
}

/** One statement in assetlinks.json. */
export interface AssetLinkStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/**
 * The website's /.well-known/assetlinks.json. Empty - the site vouches for no
 * app, and links stay in the browser - until both the package and at least one
 * valid fingerprint are set.
 */
export function assetLinksFor(links: AndroidAppLinks | null | undefined): AssetLinkStatement[] {
  const pkg = links?.packageName?.trim();
  const fingerprints = (links?.certFingerprints ?? []).filter((f) => CERT_FINGERPRINT_RE.test(f));
  if (!pkg || !ANDROID_PACKAGE_RE.test(pkg) || !fingerprints.length) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
