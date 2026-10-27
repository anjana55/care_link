import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID as uuid } from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { passwordResetTokens, refreshTokens, users, type UserRole } from '../database/schema';
import { EmailService } from '../email/email.service';

/** Accounts that sign in on the public site, and so can reset a password there. */
export const PUBLIC_SITE_ROLES: readonly UserRole[] = ['CAREGIVER', 'PATIENT_GUARDIAN', 'EMPLOYER'];

/** A link someone asks for is used straight away; one an admin sends may sit in an inbox for a while. */
const SELF_SERVICE_TTL_MS = 60 * 60 * 1000;
const STAFF_SENT_TTL_MS = 24 * 60 * 60 * 1000;
/** One self-service email per account per minute, whatever the request rate. */
const RESEND_GAP_MS = 60 * 1000;

const INVALID_LINK = 'This password reset link is invalid or has expired. Ask for a new one.';

type ResetUser = { id: string; email: string | null; fullName: string; role: UserRole; isActive: boolean; passwordHash: string | null };

/**
 * Setting a new password without the old one: "Forgot password?" on the
 * public site, and an admin either emailing the same link or setting a
 * password for someone directly.
 *
 * Only for accounts that sign in on the public site (caregivers, clients,
 * employers). Staff accounts are reset by an admin under Users, as before.
 *
 * Proving the inbox is what a link does, so using one also confirms the email
 * address - a client the office imported with no password, or a caregiver who
 * never clicked the verification email, can sign in straight after.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The public "Forgot password?" form. The answer is the same whether or not
   * the address has an account, so the form can't be used to find out who is
   * registered.
   */
  async requestReset(email: string): Promise<{ message: string }> {
    const generic = { message: 'If an account uses this email address, we have sent it a link to set a new password.' };
    const [user] = await this.db.select().from(users).where(eq(users.email, email.trim())).limit(1);
    if (!user || !user.isActive || !PUBLIC_SITE_ROLES.includes(user.role) || !user.email) return generic;

    // A burst of requests sends one email, not one each.
    const [recent] = await this.db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.requestedBy), gt(passwordResetTokens.createdAt, new Date(Date.now() - RESEND_GAP_MS))))
      .limit(1);
    if (recent) return generic;

    await this.issue(user, null, SELF_SERVICE_TTL_MS);
    return generic;
  }

  /** Lets the reset page say "this link has expired" before anyone types a password. */
  async checkToken(token: string): Promise<{ valid: true; role: UserRole; firstPassword: boolean; email: string | null }> {
    const { user } = await this.findUsable(token);
    return { valid: true, role: user.role, firstPassword: !user.passwordHash, email: user.email };
  }

  /** Sets the password from a link. Signs out every session and voids every other link. */
  async resetWithToken(token: string, newPassword: string): Promise<{ success: true; role: UserRole; userId: string }> {
    const { record, user } = await this.findUsable(token);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.transaction(async (tx) => {
      // Claimed inside the transaction so two submits of the same link can't both win.
      const claimed = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.id, record.id), isNull(passwordResetTokens.usedAt)));
      if (!affected(claimed)) throw new UnauthorizedException(INVALID_LINK);
      await tx
        .update(users)
        .set({ passwordHash, ...(user.emailVerified ? {} : { emailVerifiedAt: new Date() }) })
        .where(eq(users.id, user.id));
      await this.voidEverything(tx as unknown as Database, user.id);
    });
    return { success: true, role: user.role, userId: user.id };
  }

  /** An admin emails the person a link (valid for a day). Needs an email address on the account. */
  async sendLinkFor(userId: string, adminId: string): Promise<{ email: string; expiresAt: Date }> {
    const user = await this.manageable(userId);
    if (!user.email) throw new BadRequestException('This account has no email address. Add one first, then send the link.');
    const expiresAt = await this.issue(user, adminId, STAFF_SENT_TTL_MS);
    return { email: user.email, expiresAt };
  }

  /**
   * An admin sets the password directly, to hand over in person or by phone.
   * The email address counts as confirmed from then on (the office vouches
   * for it, as with an import), or the person could still not sign in.
   */
  async setPasswordFor(userId: string, newPassword: string | undefined): Promise<{ email: string }> {
    if (!newPassword) throw new BadRequestException('Enter the new password.');
    const user = await this.manageable(userId);
    if (!user.email) throw new BadRequestException('This account has no email address, so a password cannot be used to sign in. Add an email address first.');
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() }).where(eq(users.id, user.id));
      await this.voidEverything(tx as unknown as Database, user.id);
    });
    return { email: user.email };
  }

  private async manageable(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !PUBLIC_SITE_ROLES.includes(user.role)) throw new BadRequestException('This person has no sign-in account yet.');
    return user;
  }

  /** Writes a new link (voiding the older ones) and emails it. Returns when it expires. */
  private async issue(user: ResetUser, requestedBy: string | null, ttlMs: number): Promise<Date> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.db.transaction(async (tx) => {
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
      await tx.insert(passwordResetTokens).values({ id: uuid(), userId: user.id, tokenHash: hash(token), expiresAt, requestedBy });
    });
    const base = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '');
    void this.emailService
      .sendPasswordResetEmail(user.email!, {
        resetUrl: `${base}/reset-password?token=${token}`,
        name: user.fullName,
        expiresIn: ttlMs >= STAFF_SENT_TTL_MS ? '24 hours' : '1 hour',
        byStaff: Boolean(requestedBy),
        firstPassword: !user.passwordHash,
      })
      .catch((err: Error) => this.logger.error(`Password reset email failed: ${err.message}`));
    return expiresAt;
  }

  private async findUsable(token: string) {
    if (!/^[0-9a-f]{64}$/.test(token ?? '')) throw new UnauthorizedException(INVALID_LINK);
    const [record] = await this.db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hash(token))).limit(1);
    if (!record || record.usedAt || record.expiresAt < new Date()) throw new UnauthorizedException(INVALID_LINK);
    const [user] = await this.db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user || !user.isActive || !PUBLIC_SITE_ROLES.includes(user.role)) throw new UnauthorizedException(INVALID_LINK);
    return { record, user: { ...user, emailVerified: Boolean(user.emailVerifiedAt) } };
  }

  /** Signs the account out everywhere and voids any outstanding reset links. */
  private async voidEverything(db: Database, userId: string) {
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** mysql2 reports affected rows on the first element of the result tuple. */
function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return (header as { affectedRows?: number })?.affectedRows ?? 0;
}
