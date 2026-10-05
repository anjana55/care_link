import { mysqlTable, varchar, datetime, mysqlEnum, uniqueIndex, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * The identity providers a caregiver can secure their account with. The values
 * are what appears in the API path (`/auth/social/:provider/start`) and in the
 * frontend's provider registry, so renaming one is a breaking change.
 */
export const socialProviderEnum = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as const;
export type SocialProvider = (typeof socialProviderEnum)[number];

/**
 * A caregiver's Google/Microsoft/Facebook identity, linked to their `users` row.
 *
 * Only ever written by the social sign-in callback (SocialAuthService), and only
 * for a user that a pending-registration token has just proven the current
 * browser session created. Nothing else in the app reads this table.
 */
export const socialAccounts = mysqlTable(
  'social_accounts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    provider: mysqlEnum('provider', socialProviderEnum).notNull(),
    // The provider's own stable id for this person (`sub` for Google and
    // Microsoft, `id` for Facebook). Never their email: an address can be
    // changed or reassigned by the provider, whereas this does not.
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    // The address the provider asserted at link time. Kept for support and to
    // explain a later "email mismatch" rejection; users.email is the one the
    // app actually authenticates against.
    providerEmail: varchar('provider_email', { length: 255 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    // One provider identity can never point at two users. Without this, an
    // account created through one flow could be claimed through another.
    providerIdentityIdx: uniqueIndex('social_accounts_provider_identity_idx').on(table.provider, table.providerAccountId),
    // And one user cannot link the same provider twice.
    userProviderIdx: uniqueIndex('social_accounts_user_provider_idx').on(table.userId, table.provider),
    userIdx: index('social_accounts_user_idx').on(table.userId),
  }),
);

/**
 * A single-use code that carries a finished social sign-in from the API's OAuth
 * callback back to the browser.
 *
 * The callback runs as a top-level browser navigation, so the tokens it mints
 * cannot be returned in a response body - they have to travel in a URL. Putting
 * the access token itself in that URL would leak it into browser history, the
 * Referer header and every server access log along the way. Instead the callback
 * mints one of these, redirects with only the code, and the frontend immediately
 * exchanges it for the token pair over POST (`POST /auth/social/exchange`).
 *
 * The 60-second TTL is what makes that safe: the code is worthless to anyone who
 * finds it later, and `usedAt` stops it being spent twice.
 *
 * Mirrors emailVerificationTokens - the secret is hashed, never stored.
 */
export const authHandoffCodes = mysqlTable(
  'auth_handoff_codes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    // sha256 of the code. The code itself never touches the database.
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    expiresAt: datetime('expires_at').notNull(),
    usedAt: datetime('used_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('auth_handoff_codes_user_idx').on(table.userId),
    // The exchange looks a code up by its hash on every attempt.
    hashIdx: index('auth_handoff_codes_hash_idx').on(table.codeHash),
  }),
);