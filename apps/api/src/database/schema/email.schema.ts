import { mysqlTable, varchar, datetime, boolean, int, text } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * Admin-managed outgoing mail (SMTP) settings - a single row, id 'default'.
 *
 * Same model as the WhatsApp and social sign-in settings: an admin manages
 * the mail server under Settings > Email, and every send reads this row, so a
 * change (or switching delivery off in an incident) applies immediately with
 * no restart. The SMTP_* environment variables only seed the row the first
 * time it is needed, so an existing deployment keeps sending; after that the
 * row is the source of truth and editing the environment has no effect.
 *
 * The password is encrypted at rest (secret-box.util.ts) and never returned by
 * the API - the admin UI only learns that one is stored, and its last four
 * characters.
 */
export const emailSettings = mysqlTable('email_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  // Off = emails are written to the API log instead of being delivered, which
  // is also what happens before anyone has configured a server.
  enabled: boolean('enabled').notNull().default(false),
  host: varchar('host', { length: 255 }),
  port: int('port').notNull().default(587),
  // true = implicit TLS on connect (usually port 465); false = STARTTLS (587).
  secure: boolean('secure').notNull().default(false),
  username: varchar('username', { length: 255 }),
  passwordEncrypted: text('password_encrypted'),
  fromName: varchar('from_name', { length: 128 }).notNull().default('CareLink'),
  fromAddress: varchar('from_address', { length: 255 }),
  replyTo: varchar('reply_to', { length: 255 }),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
