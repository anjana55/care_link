import { mysqlTable, varchar, int, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * How a claim code reached the caregiver.
 *
 * - EMAIL: six digits sent to the (unverified) address on the account, used
 *   when WhatsApp delivery is off for caregivers.
 * - STAFF: eight characters a staff member generated after checking the
 *   person's identity themselves (in person or by phone), for someone who has
 *   lost the phone and has no email on file.
 *
 * WhatsApp codes are not stored here: they go through the existing
 * whatsapp_otps table with purpose CLAIM, so they share its resend cooldown
 * and attempt limits.
 */
export const accountClaimChannelEnum = ['EMAIL', 'STAFF'] as const;
export type AccountClaimChannel = (typeof accountClaimChannelEnum)[number];

/**
 * A single-use code that lets a caregiver finish an account they registered
 * but never secured (no Google/Microsoft/Facebook link, no password), by
 * entering it with their registration number. A correct code buys exactly what
 * the end of the registration form buys: a short-lived pending token for
 * linking a provider. See AccountClaimService.
 *
 * Keyed by caregiver rather than user, because a staff-entered caregiver has no
 * login yet - claiming is what creates it.
 */
export const accountClaimCodes = mysqlTable(
  'account_claim_codes',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    channel: mysqlEnum('channel', accountClaimChannelEnum).notNull(),
    // sha256(id + ':' + code). The code itself never touches the database.
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull(),
    expiresAt: datetime('expires_at').notNull(),
    consumedAt: datetime('consumed_at'),
    // The staff member who issued a STAFF code; null for EMAIL codes.
    createdBy: varchar('created_by', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('account_claim_codes_caregiver_idx').on(table.caregiverId),
  }),
);
