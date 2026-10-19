import { mysqlTable, varchar, datetime, mysqlEnum } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const brandingLocaleEnum = ['en', 'si', 'ta'] as const;

/**
 * Admin-managed white-label branding (Settings > Branding) - a single row,
 * id 'default', like the email, WhatsApp and billing settings. The defaults
 * are the CareLink identity the product shipped with, so a deployment that
 * never opens the page looks exactly as it did.
 *
 * The logo file itself lives in the storage service under `logo_key`;
 * `logo_version` changes with every upload so browsers can cache the image
 * forever and still pick up a new one.
 */
export const brandingSettings = mysqlTable('branding_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  companyName: varchar('company_name', { length: 120 }).notNull().default('CareLink'),
  shortName: varchar('short_name', { length: 4 }).notNull().default('CL'),
  tagline: varchar('tagline', { length: 160 }),
  primaryColor: varchar('primary_color', { length: 7 }).notNull().default('#5F6952'),
  accentColor: varchar('accent_color', { length: 7 }).notNull().default('#2F7A84'),

  logoKey: varchar('logo_key', { length: 255 }),
  logoMimeType: varchar('logo_mime_type', { length: 40 }),
  logoVersion: varchar('logo_version', { length: 40 }),

  defaultLocale: mysqlEnum('default_locale', brandingLocaleEnum).notNull().default('en'),
  // Comma-separated subset of brandingLocaleEnum, e.g. 'en,si,ta'.
  enabledLocales: varchar('enabled_locales', { length: 32 }).notNull().default('en,si,ta'),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
