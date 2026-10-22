import { mysqlTable, varchar, datetime, boolean } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * Admin-managed Google AdSense (Settings > Ads) - a single row, id 'default',
 * like the branding, email and billing settings. Off by default, so a
 * deployment that never opens the page shows no ads at all.
 *
 * Nothing here is secret: the publisher ID and slot IDs are printed into every
 * page that shows an ad.
 */
export const adsSettings = mysqlTable('ads_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  // Canonical "ca-pub-" + 16 digits.
  publisherId: varchar('publisher_id', { length: 32 }),
  // data-ad-slot of the manually placed unit on each public page; null = none there.
  slotHome: varchar('slot_home', { length: 20 }),
  slotSearch: varchar('slot_search', { length: 20 }),
  slotProfile: varchar('slot_profile', { length: 20 }),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
