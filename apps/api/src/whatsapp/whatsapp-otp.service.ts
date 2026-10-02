import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, eq, gt, isNull, desc, sql } from 'drizzle-orm';
import { createHmac, randomInt, randomUUID as uuid, timingSafeEqual } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { whatsappOtps, type WhatsappOtpPurpose } from '../database/schema';
import { deriveKey } from '../common/utils/secret-box.util';
import type { ResolvedWhatsappSettings } from './whatsapp-settings.service';

export type OtpIssueResult =
  | { issued: true; id: string; code: string; expiresAt: Date }
  | { issued: false; reason: 'COOLDOWN' | 'HOURLY_LIMIT'; retryAfterSeconds: number };

@Injectable()
export class WhatsappOtpService {
  private readonly hashKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    config: ConfigService,
  ) {
    this.hashKey = deriveKey(config.get<string>('JWT_ACCESS_SECRET') || '', 'whatsapp-otp');
  }

  /**
   * Creates a fresh OTP for (phone, purpose), enforcing the per-number resend
   * cooldown and hourly cap. Any earlier unused code for the same pair is
   * invalidated, so only the newest code ever works.
   *
   * Returns a result rather than throwing on a rate limit: login/recovery
   * requests must answer identically whether or not anything was sent.
   */
  async issue(phone: string, purpose: WhatsappOtpPurpose, settings: ResolvedWhatsappSettings): Promise<OtpIssueResult> {
    const now = new Date();

    const [latest] = await this.db
      .select({ createdAt: whatsappOtps.createdAt })
      .from(whatsappOtps)
      .where(eq(whatsappOtps.phone, phone))
      .orderBy(desc(whatsappOtps.createdAt))
      .limit(1);
    if (latest) {
      const elapsed = (now.getTime() - new Date(latest.createdAt).getTime()) / 1000;
      if (elapsed < settings.otpResendCooldownSeconds) {
        return { issued: false, reason: 'COOLDOWN', retryAfterSeconds: Math.ceil(settings.otpResendCooldownSeconds - elapsed) };
      }
    }

    const [{ value: sentLastHour }] = await this.db
      .select({ value: count() })
      .from(whatsappOtps)
      .where(and(eq(whatsappOtps.phone, phone), gt(whatsappOtps.createdAt, new Date(now.getTime() - 3_600_000))));
    if (sentLastHour >= settings.otpMaxSendsPerHour) {
      return { issued: false, reason: 'HOURLY_LIMIT', retryAfterSeconds: 3600 };
    }

    // Invalidate any outstanding code for this number+purpose.
    await this.db
      .update(whatsappOtps)
      .set({ consumedAt: now })
      .where(and(eq(whatsappOtps.phone, phone), eq(whatsappOtps.purpose, purpose), isNull(whatsappOtps.consumedAt)));

    const id = uuid();
    const code = String(randomInt(0, 10 ** settings.otpLength)).padStart(settings.otpLength, '0');
    const expiresAt = new Date(now.getTime() + settings.otpTtlSeconds * 1000);
    await this.db.insert(whatsappOtps).values({
      id,
      phone,
      purpose,
      codeHash: this.hash(id, code),
      expiresAt,
      maxAttempts: settings.otpMaxAttempts,
      // Set from the app clock, not the column default: cooldown and hourly
      // limits compare this against `now` above, and mixing the DB server's
      // clock with Node's would skew them whenever the two differ.
      createdAt: now,
    });

    // Cheap housekeeping so the table doesn't grow without a scheduler.
    if (Math.random() < 0.05) void this.purgeExpired().catch(() => undefined);

    return { issued: true, id, code, expiresAt };
  }

  /**
   * Checks a submitted code. Resolves true exactly once per OTP; every
   * failure mode (no code, expired, used, locked out, wrong) is the same
   * `false`, so a caller can't tell them apart - and neither can an attacker.
   */
  async verify(phone: string, purpose: WhatsappOtpPurpose, code: string): Promise<boolean> {
    const [otp] = await this.db
      .select()
      .from(whatsappOtps)
      .where(and(eq(whatsappOtps.phone, phone), eq(whatsappOtps.purpose, purpose), isNull(whatsappOtps.consumedAt)))
      .orderBy(desc(whatsappOtps.createdAt))
      .limit(1);

    if (!otp || new Date(otp.expiresAt) <= new Date()) return false;

    // Count the attempt *before* comparing, atomically and only while the
    // budget lasts - concurrent guesses can't slip extra tries past the limit.
    const attempt = await this.db
      .update(whatsappOtps)
      .set({ attempts: sql`${whatsappOtps.attempts} + 1` })
      .where(and(eq(whatsappOtps.id, otp.id), isNull(whatsappOtps.consumedAt), sql`${whatsappOtps.attempts} < ${whatsappOtps.maxAttempts}`));
    if (affectedRows(attempt) !== 1) return false;

    const expected = Buffer.from(otp.codeHash, 'hex');
    const actual = Buffer.from(this.hash(otp.id, code.trim()), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      // Last permitted guess spent: burn the code so it can't be retried.
      if (otp.attempts + 1 >= otp.maxAttempts) {
        await this.db.update(whatsappOtps).set({ consumedAt: new Date() }).where(eq(whatsappOtps.id, otp.id));
      }
      return false;
    }

    // Single use, even under a race between two correct submissions.
    const consumed = await this.db
      .update(whatsappOtps)
      .set({ consumedAt: new Date() })
      .where(and(eq(whatsappOtps.id, otp.id), isNull(whatsappOtps.consumedAt)));
    return affectedRows(consumed) === 1;
  }

  /** Housekeeping: drops OTP rows that expired more than a day ago. */
  async purgeExpired(): Promise<void> {
    await this.db.delete(whatsappOtps).where(sql`${whatsappOtps.expiresAt} < (NOW() - INTERVAL 1 DAY)`);
  }

  throwRateLimited(retryAfterSeconds: number): never {
    throw new HttpException(
      `Please wait ${retryAfterSeconds} seconds before requesting another code`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private hash(otpId: string, code: string): string {
    return createHmac('sha256', this.hashKey).update(`${otpId}:${code}`).digest('hex');
  }
}

// mysql2 reports changed rows on the first element of the result tuple.
function affectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return (header as { affectedRows?: number } | undefined)?.affectedRows ?? 0;
}
