import { mysqlTable, varchar, datetime, boolean } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * Admin-managed Google Analytics 4 (Settings > Analytics) - a single row, id
 * 'default', like the ads, branding, email and billing settings. Off by
 * default, so a deployment that never opens the page sends nothing to Google.
 *
 * Nothing here is secret: the measurement ID is printed into every page that
 * is measured.
 */
export const analyticsSettings = mysqlTable('analytics_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  // Canonical "G-" + letters/digits.
  measurementId: varchar('measurement_id', { length: 32 }),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
