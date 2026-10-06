import { BadRequestException, ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID as uuid } from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { refreshTokens, users, caregivers, patients, emailVerificationTokens, type UserRole } from '../database/schema';
import { JwtPayload } from './strategies/jwt.strategy';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';
import { canUsePortal, WrongPortalException, type LoginPortal } from '../common/auth/login-portal';
import { RegisterPatientDto } from './dto/register-patient.dto';
import {
  generateRegistrationNumber,
  assertUniqueContactFields,
  selfRegisteredCaregiverValues,
} from '../caregivers/caregiver-creation.util';
import { resolveLocationRefs } from '../common/utils/location.util';
import { EmailService } from '../email/email.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { assertNoWhatsappLoginForPhone } from './phone-accounts.util';
import { normalizePhone } from '../common/utils/phone.util';
import { buildPatientIntake } from '../clients/patient-profile.util';

// Self-registering roles must verify their email before their first login;
// staff/admin/verifier accounts are created by an already-authenticated admin
// and are auto-verified at creation (see UsersService.create).
const SELF_REGISTERED_ROLES: UserRole[] = ['CAREGIVER', 'PATIENT_GUARDIAN'];

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly whatsappSettings: WhatsappSettingsService,
  ) {}

  async validateUser(email: string, password: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    // A WhatsApp-registered account has no password hash; it can only sign in
    // with an OTP, so the email/password path always rejects it.
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async login(email: string, password: string, portal?: LoginPortal) {
    // A client that does not say which portal it is cannot be held to one. That
    // is tolerated by default so a rolling deploy (API first, web apps after)
    // does not lock everyone out; once every client sends it, setting
    // AUTH_REQUIRE_LOGIN_PORTAL=true closes the gap. Checked before the password
    // so the answer does not depend on whether the credentials were good.
    if (!portal && this.config.get<string>('AUTH_REQUIRE_LOGIN_PORTAL') === 'true') {
      throw new BadRequestException('portal is required');
    }

    const user = await this.validateUser(email, password);

    // After the password is proven and BEFORE anything else is said about the
    // account (such as "verify your email"), so nothing about an account that
    // belongs to another portal is ever revealed here.
    if (portal && !canUsePortal(user.role, portal)) {
      throw new WrongPortalException(user.id, portal);
    }

    if (SELF_REGISTERED_ROLES.includes(user.role) && !user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email before logging in - check your inbox for the verification link.');
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issueTokens(await this.buildPayload(user));
  }

  /**
   * Public self-registration: creates the caregiver's login (`users`, role
   * CAREGIVER, unverified) and their profile record (`caregivers`, status
   * DRAFT) atomically, so a mid-flight failure (e.g. a duplicate NIC caught
   * after the user row is written) never leaves an unusable orphaned
   * account behind.
   */
  async registerCaregiver(dto: RegisterCaregiverDto) {
    const { email, password, consentAccepted, ...caregiverFields } = dto;

    const [existingUser] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
    await this.assertNoWhatsappLogin(caregiverFields.primaryPhone);

    const verificationToken = randomBytes(32).toString('hex');

    const result = await this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      await assertUniqueContactFields(txDb, caregiverFields);
      const location = await resolveLocationRefs(txDb, caregiverFields);

      const userId = uuid();
      const passwordHash = await bcrypt.hash(password, 12);
      await tx.insert(users).values({
        id: userId,
        email,
        passwordHash,
        fullName: caregiverFields.fullName,
        role: 'CAREGIVER',
        isActive: true,
        emailVerifiedAt: null,
      });

      const caregiverId = uuid();
      const registrationNumber = await generateRegistrationNumber(txDb);
      await tx.insert(caregivers).values(
        selfRegisteredCaregiverValues({
          id: caregiverId,
          publicId: uuid(),
          userId,
          registrationNumber,
          fields: caregiverFields,
          location,
        }),
      );

      await tx.insert(emailVerificationTokens).values({
        id: uuid(),
        userId,
        tokenHash: this.hashToken(verificationToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      });

      return { userId, caregiverId, registrationNumber };
    });

    const verificationUrl = `${this.frontendUrl('CAREGIVER')}/verify-email?token=${verificationToken}`;
    void this.emailService.sendVerificationEmail(email, verificationUrl, 'CAREGIVER');

    return {
      caregiverId: result.caregiverId,
      registrationNumber: result.registrationNumber,
      message: 'Registration successful. Please check your email to verify your account before logging in.',
      // DEV-ONLY convenience: echoes the link back here too (see the
      // matching UI in both register pages), so registration stays testable
      // end-to-end without a real inbox or SMTP setup. Never present in
      // production - see the NODE_ENV check below.
      ...(this.config.get<string>('NODE_ENV') !== 'production' ? { devVerificationUrl: verificationUrl } : {}),
    };
  }

  /**
   * Public self-registration for a patient/guardian - the person searching
   * for and hiring a caregiver. Mirrors registerCaregiver's shape: creates
   * the login (`users`, role PATIENT_GUARDIAN, unverified) and the profile
   * (`patients`) atomically, then sends the same stubbed verification email.
   */
  async registerPatient(dto: RegisterPatientDto) {
    const { email, password, fullName, phone } = dto;

    const [existingUser] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }
    await this.assertNoWhatsappLogin(phone);

    const verificationToken = randomBytes(32).toString('hex');

    const result = await this.db.transaction(async (tx) => {
      // Validated first so a bad location or contact method never leaves a
      // half-created account behind.
      const intake = await buildPatientIntake(tx as unknown as Database, dto, { hasEmail: true });

      const userId = uuid();
      const passwordHash = await bcrypt.hash(password, 12);
      await tx.insert(users).values({
        id: userId,
        email,
        passwordHash,
        fullName,
        role: 'PATIENT_GUARDIAN',
        isActive: true,
        emailVerifiedAt: null,
      });

      const patientId = uuid();
      await tx.insert(patients).values({
        id: patientId,
        userId,
        fullName,
        phone,
        consentAcceptedAt: new Date(),
        ...intake,
        // Every self-registered client starts unreviewed; staff promote it to
        // ACTIVE from the staff app.
        status: 'PENDING_REVIEW',
      });

      await tx.insert(emailVerificationTokens).values({
        id: uuid(),
        userId,
        tokenHash: this.hashToken(verificationToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      });

      return { userId, patientId };
    });

    const verificationUrl = `${this.frontendUrl('PATIENT_GUARDIAN')}/verify-email?token=${verificationToken}`;
    void this.emailService.sendVerificationEmail(email, verificationUrl, 'PATIENT_GUARDIAN');

    return {
      patientId: result.patientId,
      message: 'Registration successful. Please check your email to verify your account before logging in.',
      // DEV-ONLY escape hatch - see the identical field on registerCaregiver.
      ...(this.config.get<string>('NODE_ENV') !== 'production' ? { devVerificationUrl: verificationUrl } : {}),
    };
  }

  /**
   * An email sign-up whose phone number is already a WhatsApp login belongs to
   * someone who has an account - point them at WhatsApp rather than creating a
   * second identity for the same number.
   */
  private async assertNoWhatsappLogin(rawPhone: string | undefined) {
    if (!rawPhone) return;
    const { defaultCountryCode } = await this.whatsappSettings.getResolved();
    await assertNoWhatsappLoginForPhone(this.db, normalizePhone(rawPhone, defaultCountryCode));
  }

  async verifyEmail(token: string) {
    const tokenHash = this.hashToken(token);
    const [record] = await this.db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('This verification link is invalid or has expired');
    }

    await this.db.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, record.id));
    await this.db.update(users).set({ emailVerifiedAt: new Date(), lastLoginAt: new Date() }).where(eq(users.id, record.userId));

    const [user] = await this.db.select().from(users).where(eq(users.id, record.userId)).limit(1);
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }

    // Smoother self-service UX: verifying immediately logs them in rather
    // than sending them back to a separate login form.
    return this.issueTokens(await this.buildPayload(user));
  }

  async resendVerification(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    // Deliberately generic response either way - confirming or denying an
    // email's existence to an anonymous caller is its own small leak.
    if (user && SELF_REGISTERED_ROLES.includes(user.role) && !user.emailVerifiedAt) {
      const token = randomBytes(32).toString('hex');
      await this.db.insert(emailVerificationTokens).values({
        id: uuid(),
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      });
      void this.emailService.sendVerificationEmail(email, `${this.frontendUrl(user.role)}/verify-email?token=${token}`, user.role as 'CAREGIVER' | 'PATIENT_GUARDIAN');
    }

    return { message: 'If an account with this email exists and is not yet verified, a new verification link has been sent.' };
  }

  async refresh(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const [stored] = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, payload.sub),
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.revoked, false),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!stored) {
      throw new UnauthorizedException('Refresh token has been revoked or expired');
    }

    // The account may have been deactivated, deleted, or had its role changed
    // since this token was issued - never mint new tokens from stale claims.
    const [account] = await this.db
      .select({ email: users.email, phone: users.phone, role: users.role, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!account || !account.isActive) {
      await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, payload.sub));
      throw new UnauthorizedException('Account is disabled or no longer exists');
    }

    // Rotate: revoke the used token, issue a new pair.
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.id, stored.id));

    // caregiverId/patientId never change once assigned, so they're carried
    // over from the token being rotated rather than re-queried.
    return this.issueTokens({
      sub: payload.sub,
      email: account.email,
      phone: account.phone,
      role: account.role,
      caregiverId: payload.caregiverId,
      patientId: payload.patientId,
    });
  }

  async logout(userId: string) {
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    if (!user.passwordHash) {
      throw new BadRequestException('This account signs in with WhatsApp and has no password to change');
    }
    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Revoke every other session - the caller's own follow-up login (or
    // this request's still-valid access token) is unaffected, but any
    // stolen/forgotten-about refresh token stops working immediately.
    await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, userId));
  }

  /**
   * Issues the same access/refresh token pair email login does, for a user a
   * different method has already authenticated (WhatsApp OTP). Everything
   * downstream - roles, guards, caregiverId/patientId claims, refresh
   * rotation, logout - is shared, which is what keeps WhatsApp users
   * identical in access to email users.
   */
  async startSession(user: { id: string; email: string | null; phone?: string | null; role: UserRole }) {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issueTokens(await this.buildPayload(user));
  }

  private async buildPayload(user: { id: string; email: string | null; phone?: string | null; role: UserRole }): Promise<JwtPayload> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    if (user.phone) payload.phone = user.phone;
    if (user.role === 'CAREGIVER') {
      const [caregiver] = await this.db.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.userId, user.id)).limit(1);
      if (caregiver) payload.caregiverId = caregiver.id;
    }
    if (user.role === 'PATIENT_GUARDIAN') {
      const [patient] = await this.db.select({ id: patients.id }).from(patients).where(eq(patients.userId, user.id)).limit(1);
      if (patient) payload.patientId = patient.id;
    }
    return payload;
  }

  private async issueTokens(payload: JwtPayload) {
    // See the comment in auth.module.ts: these durations are validated env
    // strings at runtime, not statically-known template literals.
    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as any,
    });

    // A unique token id (`jti`) on the refresh token. Without it, two
    // sessions minted for the same user within the same second carry identical
    // claims and therefore sign to the *same string*, so they share one
    // token_hash row: revoking "the old session" would also revoke (or fail
    // to revoke) the new one. That matters for WhatsApp account recovery,
    // which revokes every session and immediately issues a fresh one.

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn as any,
      jwtid: uuid(),
    });

    await this.db.insert(refreshTokens).values({
      id: uuid(),
      userId: payload.sub,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: this.addDuration(refreshExpiresIn),
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    // Deterministic digest for lookup purposes - the token itself (which
    // never leaves the client's storage / the recipient's inbox) is the
    // actual secret.
    return createHash('sha256').update(token).digest('hex');
  }

  private addDuration(duration: string): Date {
    const match = /^(\d+)([smhd])$/.exec(duration);
    const now = new Date();
    if (!match) return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit]!;
    return new Date(now.getTime() + value * multiplier);
  }

  /**
   * There are two distinct frontends, on different origins: the staff/
   * caregiver app (apps/web) and the public patient/guardian app
   * (apps/public-web). Verification links must point at whichever one the
   * registering role actually uses, so this is role-aware rather than
   * reading the first CORS_ORIGIN entry (which only happens to be correct
   * for CAREGIVER).
   */
  private frontendUrl(role: UserRole): string {
    if (role === 'PATIENT_GUARDIAN') {
      return this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002';
    }
    return this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000';
  }

}
