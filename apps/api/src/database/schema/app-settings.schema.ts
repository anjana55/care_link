import { mysqlTable, varchar, datetime } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * Mobile app version control (Settings > Mobile app) - a single row, id
 * 'default', like the other settings. Per platform: the minimum version that
 * may still be used, the latest version (older builds are offered an update)
 * and the store link. All empty by default, so a deployment that never opens
 * the page never blocks or nags anyone. Nothing here is secret: the app reads
 * it signed out, at start-up (GET /public/app-config).
 */
export const appSettings = mysqlTable('app_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  iosMinimumVersion: varchar('ios_minimum_version', { length: 16 }),
  iosLatestVersion: varchar('ios_latest_version', { length: 16 }),
  iosStoreUrl: varchar('ios_store_url', { length: 500 }),
  androidMinimumVersion: varchar('android_minimum_version', { length: 16 }),
  androidLatestVersion: varchar('android_latest_version', { length: 16 }),
  androidStoreUrl: varchar('android_store_url', { length: 500 }),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
