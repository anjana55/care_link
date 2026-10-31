import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  APP_PLATFORMS,
  APP_VERSION_RE,
  EMPTY_APP_CONFIG,
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

export type AdminAppSettings = AppConfig & { updatedAt: Date };

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
    return { ...toConfig(row), updatedAt: row.updatedAt };
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

    await this.db
      .update(appSettings)
      .set({ ...set, updatedBy, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
