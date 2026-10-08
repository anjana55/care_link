import { mysqlTable, varchar, int, boolean, datetime, mysqlEnum, text, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// CLAIM: a caregiver finishing an account they registered but never secured
// (see AccountClaimService). Keyed by the phone on their caregiver record.
export const whatsappOtpPurposeEnum = ['REGISTER', 'LOGIN', 'RECOVERY', 'CLAIM'] as const;
export type WhatsappOtpPurpose = (typeof whatsappOtpPurposeEnum)[number];

export const whatsappProviderEnum = ['META_CLOUD', 'CONSOLE'] as const;
export type WhatsappProvider = (typeof whatsappProviderEnum)[number];

/**
 * One-time passcodes sent over WhatsApp. Only a keyed hash of the code is
 * stored (never the code itself), each row is single-use, and `maxAttempts`
 * is snapshotted at issue time so changing the admin setting never alters an
 * OTP that is already in flight.
 */
export const whatsappOtps = mysqlTable(
  'whatsapp_otps',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    phone: varchar('phone', { length: 20 }).notNull(),
    purpose: mysqlEnum('purpose', whatsappOtpPurposeEnum).notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull(),
    consumedAt: datetime('consumed_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    phonePurposeIdx: index('whatsapp_otps_phone_purpose_idx').on(table.phone, table.purpose),
  }),
);

/**
 * Admin-managed WhatsApp authentication settings. A single row (id =
 * 'default'): feature toggles, Cloud API credentials, the approved template
 * and the OTP policy. The access token is encrypted at rest (see
 * secret-box.util.ts) and is never returned by the API.
 */
export const whatsappAuthSettings = mysqlTable('whatsapp_auth_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),

  // Feature toggles. `enabled` is the master switch; the rest narrow it.
  enabled: boolean('enabled').notNull().default(false),
  caregiverEnabled: boolean('caregiver_enabled').notNull().default(true),
  customerEnabled: boolean('customer_enabled').notNull().default(true),
  registrationEnabled: boolean('registration_enabled').notNull().default(true),
  loginEnabled: boolean('login_enabled').notNull().default(true),
  recoveryEnabled: boolean('recovery_enabled').notNull().default(true),

  // Delivery. CONSOLE logs the OTP instead of sending it (development only).
  provider: mysqlEnum('provider', whatsappProviderEnum).notNull().default('CONSOLE'),
  apiBaseUrl: varchar('api_base_url', { length: 255 }).notNull().default('https://graph.facebook.com'),
  apiVersion: varchar('api_version', { length: 16 }).notNull().default('v21.0'),
  phoneNumberId: varchar('phone_number_id', { length: 64 }),
  businessAccountId: varchar('business_account_id', { length: 64 }),
  accessTokenEncrypted: text('access_token_encrypted'),

  // The pre-approved WhatsApp authentication template carrying the code.
  templateName: varchar('template_name', { length: 128 }).notNull().default('carelink_otp'),
  templateLanguage: varchar('template_language', { length: 16 }).notNull().default('en'),
  templateHasCopyCodeButton: boolean('template_has_copy_code_button').notNull().default(true),

  // OTP policy.
  otpLength: int('otp_length').notNull().default(6),
  otpTtlSeconds: int('otp_ttl_seconds').notNull().default(300),
  otpMaxAttempts: int('otp_max_attempts').notNull().default(5),
  otpResendCooldownSeconds: int('otp_resend_cooldown_seconds').notNull().default(60),
  otpMaxSendsPerHour: int('otp_max_sends_per_hour').notNull().default(5),
  defaultCountryCode: varchar('default_country_code', { length: 4 }).notNull().default('94'),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
