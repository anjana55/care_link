/**
 * Mobile app version control, set in the staff app under Settings > Mobile app
 * and read by the app on every start (GET /public/app-config). One definition
 * shared by the API (which validates and stores it), the admin form and the
 * app, so what counts as a version - and which one is older - can't drift.
 *
 * Below the minimum, the app stops and asks for an update (for a change the
 * API can no longer serve to old builds). Below the latest, it suggests one
 * and carries on.
 */

export const APP_PLATFORMS = ['ios', 'android'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

/** Store version numbers: 1 to 3 numbers separated by dots, e.g. 1.4 or 1.4.2. */
export const APP_VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,2}$/;

export interface AppPlatformConfig {
  /** Older builds are blocked until updated. Null: no minimum. */
  minimumVersion: string | null;
  /** Older builds are offered an update. Null: no suggestion. */
  latestVersion: string | null;
  /** The app's page in the App Store / Play Store. Null until it is published. */
  storeUrl: string | null;
}

/** GET /public/app-config. */
export type AppConfig = Record<AppPlatform, AppPlatformConfig>;

export const EMPTY_APP_PLATFORM_CONFIG: AppPlatformConfig = { minimumVersion: null, latestVersion: null, storeUrl: null };
export const EMPTY_APP_CONFIG: AppConfig = { ios: EMPTY_APP_PLATFORM_CONFIG, android: EMPTY_APP_PLATFORM_CONFIG };

/** -1, 0 or 1, comparing number by number; a missing part counts as 0 (1.4 = 1.4.0). Null for anything that isn't a version. */
export function compareAppVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (!APP_VERSION_RE.test(a) || !APP_VERSION_RE.test(b)) return null;
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type AppUpdateStatus = 'required' | 'available' | 'current';

/**
 * Where this build stands. Anything unreadable - the build's own version, or
 * a setting - counts as current: a typo in Settings must never lock everyone
 * out of the app.
 */
export function appUpdateStatus(installed: string | null | undefined, config: AppPlatformConfig): AppUpdateStatus {
  if (!installed) return 'current';
  if (config.minimumVersion && compareAppVersions(installed, config.minimumVersion) === -1) return 'required';
  if (config.latestVersion && compareAppVersions(installed, config.latestVersion) === -1) return 'available';
  return 'current';
}

/** A store link has to be a real https address on the store. */
export function isStoreUrl(platform: AppPlatform, url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return platform === 'ios' ? u.hostname === 'apps.apple.com' : u.hostname === 'play.google.com';
  } catch {
    return false;
  }
}

/**
 * Anything claimed to be the app config -> a usable one. What doesn't parse is
 * dropped, so a bad answer means "no checks", never a blocked app.
 */
export function normalizeAppConfig(raw: unknown): AppConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const one = (platform: AppPlatform): AppPlatformConfig => {
    const p = (r[platform] && typeof r[platform] === 'object' ? r[platform] : {}) as Record<string, unknown>;
    const version = (v: unknown) => (typeof v === 'string' && APP_VERSION_RE.test(v) ? v : null);
    return {
      minimumVersion: version(p.minimumVersion),
      latestVersion: version(p.latestVersion),
      storeUrl: typeof p.storeUrl === 'string' && isStoreUrl(platform, p.storeUrl) ? p.storeUrl : null,
    };
  };
  return { ios: one('ios'), android: one('android') };
}
