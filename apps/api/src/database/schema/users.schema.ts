import { mysqlTable, varchar, boolean, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// EMPLOYER: an overseas employer's account (international path). Verified by
// staff before it can ask for interviews; never sees a caregiver's contact details.
export const userRoleEnum = ['ADMIN', 'STAFF', 'VERIFIER', 'CAREGIVER', 'PATIENT_GUARDIAN', 'EMPLOYER'] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Nullable since WhatsApp sign-in was added: a user who registers with a
    // WhatsApp number has no email address (and so no password either).
    // Staff/admin/verifier accounts and email-registered users always have both;
    // MySQL's UNIQUE index allows any number of NULLs, so uniqueness of real
    // addresses is unchanged.
    email: varchar('email', { length: 255 }).unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    // WhatsApp identity, stored normalised to E.164 (e.g. +94771234567). Null
    // for every email-registered account. phoneVerifiedAt is null until the
    // registration OTP is confirmed; an unverified row never signs in.
    phone: varchar('phone', { length: 20 }).unique(),
    phoneVerifiedAt: datetime('phone_verified_at'),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    role: mysqlEnum('role', userRoleEnum).notNull().default('STAFF'),
    isActive: boolean('is_active').notNull().default(true),
    // Null until the address is confirmed. Staff/admin/verifier accounts are
    // created by an already-authenticated admin (POST /users) and are
    // auto-verified at creation - this only matters for self-registered
    // CAREGIVER accounts, which start unverified.
    emailVerifiedAt: datetime('email_verified_at'),
    lastLoginAt: datetime('last_login_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    emailIdx: index('users_email_idx').on(table.email),
  }),
);

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('refresh_tokens_user_idx').on(table.userId),
  }),
);

/**
 * Stubbed email verification. A real email provider isn't wired up yet - see
 * AuthService.registerCaregiver, which logs the verification link to the
 * server console (and, outside production, returns it in the API response)
 * instead of actually sending mail. Swapping in a real provider only means
 * replacing that one delivery step; this table and the verify/resend flow
 * around it don't change.
 */
export const emailVerificationTokens = mysqlTable(
  'email_verification_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    usedAt: datetime('used_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('email_verification_tokens_user_idx').on(table.userId),
  }),
);

/**
 * One-time links for setting a new password ("Forgot password?" on the public
 * site, or an admin sending one). Only the SHA-256 of the token is stored;
 * the token itself is in the email. Issuing a new link voids the older ones,
 * and using one voids the rest, so at most one ever works.
 *
 * requestedBy is the admin who sent it, or null when the person asked for it
 * themselves.
 */
export const passwordResetTokens = mysqlTable(
  'password_reset_tokens',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    usedAt: datetime('used_at'),
    requestedBy: varchar('requested_by', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('password_reset_tokens_user_idx').on(table.userId),
    tokenIdx: index('password_reset_tokens_token_idx').on(table.tokenHash),
  }),
);
