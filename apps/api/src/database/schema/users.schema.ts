import { mysqlTable, varchar, boolean, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = ['ADMIN', 'STAFF', 'VERIFIER', 'CAREGIVER', 'PATIENT_GUARDIAN'] as const;
export type UserRole = (typeof userRoleEnum)[number];

export const users = mysqlTable(
  'users',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
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
