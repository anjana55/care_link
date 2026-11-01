import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  APP_PLATFORMS,
  ANDROID_PACKAGE_RE,
  APP_VERSION_RE,
  EMPTY_ANDROID_APP_LINKS,
  EMPTY_APP_CONFIG,
  MAX_CERT_FINGERPRINTS,
  assetLinksFor,
  parseCertFingerprints,
  type AndroidAppLinks,
  type AssetLinkStatement,
  compareAppVersions,
  isStoreUrl,
  type AppConfig,
  type AppPlatform,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { appSettings } from '../database/schema';
import type { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

const SETTINGS_ID = 'default';
type Row = typeof appSettings.$inferSelect;

export type AdminAppSettings = AppConfig & { appLinks: { android: AndroidAppLinks }; updatedAt: Date };

const COLUMNS = {
  ios: { minimumVersion: 'iosMinimumVersion', latestVersion: 'iosLatestVersion', storeUrl: 'iosStoreUrl' },
  android: { minimumVersion: 'androidMinimumVersion', latestVersion: 'androidLatestVersion', storeUrl: 'androidStoreUrl' },
} as const;

const NAMES: Record<AppPlatform, string> = { ios: 'iOS', android: 'Android' };

function toConfig(row: Row): AppConfig {
  return {
    ios: { minimumVersion: row.iosMinimumVersion, latestVersion: row.iosLatestVersion, storeUrl: row.iosStoreUrl },
    android: { minimumVersion: row.androidMinimumVersion, latestVersion: row.androidLatestVersion, storeUrl: row.androidStoreUrl },
  };
}

function toAndroidLinks(row: Row): AndroidAppLinks {
  return {
    packageName: row.androidPackage,
    certFingerprints: (row.androidCertFingerprints ?? '').split('\n').filter(Boolean),
  };
}

/** An empty or whitespace field clears the setting. */
const blank = (v: string | null | undefined) => (v == null || !v.trim() ? null : v.trim());

/**
 * Owns the single admin-managed mobile app version row (Settings > Mobile
 * app). Read on every request rather than cached, like the other settings, so
 * raising the minimum applies the next time anyone opens the app.
 */
@Injectable()
export class AppSettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(appSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  /** What the app reads at start-up. Never throws: a broken settings read means no checks, not a blocked app. */
  async getPublic(): Promise<AppConfig> {
    try {
      return toConfig(await this.getRow());
    } catch {
      return EMPTY_APP_CONFIG;
    }
  }

  async getForAdmin(): Promise<AdminAppSettings> {
    const row = await this.getRow();
    return { ...toConfig(row), appLinks: { android: toAndroidLinks(row) }, updatedAt: row.updatedAt };
  }

  /**
   * What the website publishes at /.well-known/assetlinks.json. Empty until
   * both the package and a fingerprint are set, and when the settings can't
   * be read: links then simply stay in the browser.
   */
  async getAndroidAssetLinks(): Promise<AssetLinkStatement[]> {
    try {
      return assetLinksFor(toAndroidLinks(await this.getRow()));
    } catch {
      return assetLinksFor(EMPTY_ANDROID_APP_LINKS);
    }
  }

  async update(dto: UpdateAppSettingsDto, updatedBy: string): Promise<AdminAppSettings> {
    const current = toConfig(await this.getRow());
    const set: Partial<Record<(typeof COLUMNS)[AppPlatform][keyof (typeof COLUMNS)['ios']], string | null>> = {};

    for (const platform of APP_PLATFORMS) {
      const given = dto[platform];
      const next = { ...current[platform] };
      if (given) {
        if (given.minimumVersion !== undefined) next.minimumVersion = blank(given.minimumVersion);
        if (given.latestVersion !== undefined) next.latestVersion = blank(given.latestVersion);
        if (given.storeUrl !== undefined) next.storeUrl = blank(given.storeUrl);
      }
      const name = NAMES[platform];
      for (const v of [next.minimumVersion, next.latestVersion]) {
        if (v && !APP_VERSION_RE.test(v)) throw new BadRequestException(`${name}: enter versions as numbers separated by dots, e.g. 1.4.2`);
      }
      if (next.minimumVersion && next.latestVersion && compareAppVersions(next.minimumVersion, next.latestVersion) === 1) {
        throw new BadRequestException(`${name}: the minimum version can't be newer than the latest version`);
      }
      if (next.storeUrl && !isStoreUrl(platform, next.storeUrl)) {
        throw new BadRequestException(
          platform === 'ios' ? 'iOS: the store link must be an https://apps.apple.com/... address' : 'Android: the store link must be an https://play.google.com/... address',
        );
      }
      // A minimum without a store link would stop people with nowhere to go.
      if (next.minimumVersion && !next.storeUrl) {
        throw new BadRequestException(`${name}: add the store link before setting a minimum version, so people can update`);
      }
      const cols = COLUMNS[platform];
      set[cols.minimumVersion] = next.minimumVersion;
      set[cols.latestVersion] = next.latestVersion;
      set[cols.storeUrl] = next.storeUrl;
    }

    const links = this.androidLinksFrom(dto);

    await this.db
      .update(appSettings)
      .set({ ...set, ...links, updatedBy, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }

  /** The app-link columns to save, if the form sent them. Fingerprints are kept in Android's form, one per line. */
  private androidLinksFrom(dto: UpdateAppSettingsDto): Partial<Pick<Row, 'androidPackage' | 'androidCertFingerprints'>> {
    const given = dto.appLinks?.android;
    if (!given) return {};
    const out: Partial<Pick<Row, 'androidPackage' | 'androidCertFingerprints'>> = {};
    if (given.packageName !== undefined) {
      const pkg = blank(given.packageName);
      if (pkg && !ANDROID_PACKAGE_RE.test(pkg)) {
        throw new BadRequestException('App links: the package name looks like com.example.app - letters, numbers and dots');
      }
      out.androidPackage = pkg;
    }
    if (given.certFingerprints !== undefined) {
      const { fingerprints, invalid } = parseCertFingerprints(given.certFingerprints.join('\n'));
      if (invalid.length) {
        throw new BadRequestException(`App links: "${invalid[0]}" isn't a SHA-256 fingerprint (32 pairs of letters and numbers, e.g. AB:12:...)`);
      }
      if (fingerprints.length > MAX_CERT_FINGERPRINTS) {
        throw new BadRequestException(`App links: at most ${MAX_CERT_FINGERPRINTS} fingerprints`);
      }
      out.androidCertFingerprints = fingerprints.length ? fingerprints.join('\n') : null;
    }
    return out;
  }
}
