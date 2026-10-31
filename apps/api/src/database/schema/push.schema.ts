import { mysqlTable, varchar, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const devicePlatformEnum = ['ios', 'android'] as const;
export type DevicePlatform = (typeof devicePlatformEnum)[number];

export const deviceLocaleEnum = ['en', 'si', 'ta'] as const;

/**
 * A phone with the mobile app that can receive push notifications for the
 * signed-in user. One row per Expo push token: when someone else signs in on
 * the same phone the row moves to them, so a shared phone only ever alerts
 * the person using it.
 *
 * `locale` is the app's language on that phone, so each push is written in
 * the language the person reads the app in. A row is never deleted, only
 * revoked: on sign-out (everywhere), when the person removes the device, or
 * when Expo reports the token is no longer valid (app uninstalled).
 */
export const deviceTokens = mysqlTable(
  'device_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    expoPushToken: varchar('expo_push_token', { length: 255 }).notNull().unique(),
    platform: mysqlEnum('platform', devicePlatformEnum).notNull(),
    appVersion: varchar('app_version', { length: 32 }),
    locale: mysqlEnum('locale', deviceLocaleEnum).notNull().default('en'),
    lastSeenAt: datetime('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    revokedAt: datetime('revoked_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('device_tokens_user_idx').on(table.userId),
  }),
);
