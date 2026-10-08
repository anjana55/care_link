import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHmac, randomInt, randomUUID as uuid, timingSafeEqual } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { accountClaimCodes, type AccountClaimChannel } from '../database/schema';
import { deriveKey } from '../common/utils/secret-box.util';

/**
 * No 0/O, 1/I/L: a staff code is read aloud over the phone or written on a
 * slip of paper, and the person typing it back should not have to guess.
 */
const STAFF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const CLAIM_CODE_POLICY = {
  EMAIL: { ttlMs: 15 * 60 * 1000, maxAttempts: 5, resendCooldownMs: 60 * 1000 },
  // Long enough to cover "staff call them back tomorrow"; short enough that a
  // forgotten slip of paper stops mattering.
  STAFF: { ttlMs: 48 * 60 * 60 * 1000, maxAttempts: 10, resendCooldownMs: 0 },
} as const satisfies Record<AccountClaimChannel, { ttlMs: number; maxAttempts: number; resendCooldownMs: number }>;

export type ClaimIssueResult =
  | { issued: true; code: string; expiresAt: Date }
  | { issued: false; retryAfterSeconds: number };

/**
 * Single-use claim codes for the EMAIL and STAFF channels (WhatsApp codes live
 * in whatsapp_otps). Mirrors WhatsappOtpService's guarantees: keyed hash at
 * rest, attempts counted atomically before the comparison, burned on the last
 * failed guess, consumed exactly once.
 */
@Injectable()
export class ClaimCodesService {
  private readonly hashKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.hashKey = deriveKey(config.get<string>('JWT_ACCESS_SECRET') || '', 'account-claim');
  }

  /**
   * Issues a code for a caregiver on one channel. Any earlier unused code on
   * the same channel stops working, so only the newest one is ever valid.
   */
  async issue(caregiverId: string, channel: AccountClaimChannel, createdBy: string | null = null): Promise<ClaimIssueResult> {
    const policy = CLAIM_CODE_POLICY[channel];
    const now = new Date();

    if (policy.resendCooldownMs > 0) {
      const [latest] = await this.db
        .select({ createdAt: accountClaimCodes.createdAt })
        .from(accountClaimCodes)
        .where(and(eq(accountClaimCodes.caregiverId, caregiverId), eq(accountClaimCodes.channel, channel)))
        .orderBy(desc(accountClaimCodes.createdAt))
        .limit(1);
      const elapsed = latest ? now.getTime() - new Date(latest.createdAt).getTime() : Infinity;
      if (elapsed < policy.resendCooldownMs) {
        return { issued: false, retryAfterSeconds: Math.ceil((policy.resendCooldownMs - elapsed) / 1000) };
      }
    }

    await this.db
      .update(accountClaimCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(accountClaimCodes.caregiverId, caregiverId),
          eq(accountClaimCodes.channel, channel),
          isNull(accountClaimCodes.consumedAt),
        ),
      );

    const id = uuid();
    const code = channel === 'STAFF' ? this.staffCode() : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + policy.ttlMs);
    await this.db.insert(accountClaimCodes).values({
      id,
      caregiverId,
      channel,
      codeHash: this.hash(id, code),
      maxAttempts: policy.maxAttempts,
      expiresAt,
      createdBy,
      // App clock, like the OTP table: the cooldown above compares against `now`.
      createdAt: now,
    });
    return { issued: true, code: channel === 'STAFF' ? `${code.slice(0, 4)}-${code.slice(4)}` : code, expiresAt };
  }

  /**
   * Checks a code against the caregiver's live codes of the same kind. Returns
   * the channel it was issued on, or null for every kind of failure.
   */
  async verify(caregiverId: string, rawCode: string): Promise<AccountClaimChannel | null> {
    const code = ClaimCodesService.canonical(rawCode);
    if (!code) return null;
    const now = new Date();
    // The two kinds look different (staff codes carry letters), so a code is
    // only ever checked against its own kind: typing a WhatsApp or email code
    // never spends an attempt on an outstanding staff code, or the reverse.
    const channel: AccountClaimChannel = ClaimCodesService.looksLikeStaffCode(code) ? 'STAFF' : 'EMAIL';

    const live = await this.db
      .select()
      .from(accountClaimCodes)
      .where(
        and(
          eq(accountClaimCodes.caregiverId, caregiverId),
          eq(accountClaimCodes.channel, channel),
          isNull(accountClaimCodes.consumedAt),
          gt(accountClaimCodes.expiresAt, now),
        ),
      );

    for (const row of live) {
      // Spend an attempt first, atomically and only while the budget lasts.
      const attempt = await this.db
        .update(accountClaimCodes)
        .set({ attempts: sql`${accountClaimCodes.attempts} + 1` })
        .where(
          and(
            eq(accountClaimCodes.id, row.id),
            isNull(accountClaimCodes.consumedAt),
            sql`${accountClaimCodes.attempts} < ${accountClaimCodes.maxAttempts}`,
          ),
        );
      if (affectedRows(attempt) !== 1) continue;

      const expected = Buffer.from(row.codeHash, 'hex');
      const actual = Buffer.from(this.hash(row.id, code), 'hex');
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        const consumed = await this.db
          .update(accountClaimCodes)
          .set({ consumedAt: now })
          .where(and(eq(accountClaimCodes.id, row.id), isNull(accountClaimCodes.consumedAt)));
        if (affectedRows(consumed) === 1) return row.channel;
        continue;
      }
      if (row.attempts + 1 >= row.maxAttempts) {
        await this.db.update(accountClaimCodes).set({ consumedAt: now }).where(eq(accountClaimCodes.id, row.id));
      }
    }
    return null;
  }

  /** The newest unused staff code's expiry, for the staff screen. */
  async activeStaffCodeExpiry(caregiverId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ expiresAt: accountClaimCodes.expiresAt })
      .from(accountClaimCodes)
      .where(
        and(
          eq(accountClaimCodes.caregiverId, caregiverId),
          eq(accountClaimCodes.channel, 'STAFF'),
          isNull(accountClaimCodes.consumedAt),
          gt(accountClaimCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(accountClaimCodes.createdAt))
      .limit(1);
    return row?.expiresAt ?? null;
  }

  /** Uppercase, no separators: "abcd-efgh", "ABCD EFGH" and "abcdefgh" are one code. */
  static canonical(raw: string): string {
    return (raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  /** True for the shape of a staff code (contains a letter), so callers can skip the WhatsApp check. */
  static looksLikeStaffCode(raw: string): boolean {
    return /[A-Z]/.test(ClaimCodesService.canonical(raw));
  }

  private staffCode(): string {
    let out = '';
    for (let i = 0; i < 8; i++) out += STAFF_ALPHABET[randomInt(0, STAFF_ALPHABET.length)];
    return out;
  }

  private hash(id: string, code: string): string {
    return createHmac('sha256', this.hashKey).update(`${id}:${code}`).digest('hex');
  }
}

/** mysql2 reports `affectedRows` on the result header; drizzle passes it through as the first element. */
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}
