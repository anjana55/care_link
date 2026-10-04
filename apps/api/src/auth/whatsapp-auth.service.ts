import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, patients, refreshTokens, users, type UserRole, type WhatsappOtpPurpose } from '../database/schema';
import { AuthService } from './auth.service';
import { WhatsappSettingsService, type ResolvedWhatsappSettings } from '../whatsapp/whatsapp-settings.service';
import { WhatsappOtpService } from '../whatsapp/whatsapp-otp.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import {
  generateRegistrationNumber,
  assertUniqueContactFields,
  selfRegisteredCaregiverValues,
} from '../caregivers/caregiver-creation.util';
import { resolveLocationRefs } from '../common/utils/location.util';
import { assertWhatsappNumberAvailable, purgeUnverifiedPhoneAccount } from './phone-accounts.util';
import { normalizePhone } from '../common/utils/phone.util';
import { maskPhone } from '../common/utils/masking.util';
import { RegisterCaregiverWhatsappDto, RegisterPatientWhatsappDto, RequestWhatsappOtpDto, VerifyWhatsappOtpDto } from './dto/whatsapp-auth.dto';

// Same set the email flow treats as self-registering. Staff/admin/verifier
// accounts are created by an admin and never sign in with WhatsApp.
const SELF_REGISTERED_ROLES: UserRole[] = ['CAREGIVER', 'PATIENT_GUARDIAN'];

// One message for every way a code can fail - see WhatsappOtpService.verify.
const BAD_CODE = 'This code is invalid or has expired. Request a new one and try again.';

interface OtpDispatch {
  otpSent: boolean;
  resendAfterSeconds: number;
  expiresInSeconds: number;
  devOtp?: string;
}

@Injectable()
export class WhatsappAuthService {
  private readonly logger = new Logger(WhatsappAuthService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly settings: WhatsappSettingsService,
    private readonly otp: WhatsappOtpService,
    private readonly provider: WhatsappProviderService,
  ) {}

  /** Public, secret-free view of what the sign-in screens may offer. */
  async getPublicConfig() {
    const s = await this.settings.getResolved();
    const on = (roleEnabled: boolean, flag: boolean) => s.enabled && roleEnabled && flag;
    return {
      enabled: s.enabled,
      caregiver: {
        register: on(s.caregiverEnabled, s.registrationEnabled),
        login: on(s.caregiverEnabled, s.loginEnabled),
        recovery: on(s.caregiverEnabled, s.recoveryEnabled),
      },
      customer: {
        register: on(s.customerEnabled, s.registrationEnabled),
        login: on(s.customerEnabled, s.loginEnabled),
        recovery: on(s.customerEnabled, s.recoveryEnabled),
      },
      otpLength: s.otpLength,
      otpTtlSeconds: s.otpTtlSeconds,
      resendCooldownSeconds: s.otpResendCooldownSeconds,
      defaultCountryCode: s.defaultCountryCode,
    };
  }

  async registerCaregiver(dto: RegisterCaregiverWhatsappDto) {
    const s = await this.settings.getResolved();
    this.assertAvailable(s, 'REGISTER', 'CAREGIVER', true);
    const phone = this.requirePhone(dto.whatsappNumber, s);

    const { whatsappNumber: _w, primaryPhone, consentAccepted: _c, ...rest } = dto;
    const caregiverFields = { ...rest, primaryPhone: primaryPhone?.trim() || phone };

    const result = await this.withDuplicateGuard(() =>
      this.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await purgeUnverifiedPhoneAccount(txDb, phone);
        await assertWhatsappNumberAvailable(txDb, phone, s.defaultCountryCode);
        await assertUniqueContactFields(txDb, caregiverFields);
        const location = await resolveLocationRefs(txDb, caregiverFields);

        const userId = uuid();
        await tx.insert(users).values({
          id: userId,
          email: null,
          passwordHash: null,
          phone,
          phoneVerifiedAt: null,
          fullName: caregiverFields.fullName,
          role: 'CAREGIVER',
          isActive: true,
        });

        const caregiverId = uuid();
        const registrationNumber = await generateRegistrationNumber(txDb);
        await tx.insert(caregivers).values(
          selfRegisteredCaregiverValues({ id: caregiverId, publicId: uuid(), userId, registrationNumber, fields: caregiverFields, location }),
        );
        return { userId, caregiverId, registrationNumber };
      }),
    );

    const dispatch = await this.sendRegistrationOtp(phone, s);
    return {
      caregiverId: result.caregiverId,
      registrationNumber: result.registrationNumber,
      userId: result.userId,
      phone: maskPhone(phone),
      message: this.registrationMessage(dispatch),
      ...dispatch,
    };
  }

  async registerPatient(dto: RegisterPatientWhatsappDto) {
    const s = await this.settings.getResolved();
    this.assertAvailable(s, 'REGISTER', 'PATIENT_GUARDIAN', true);
    const phone = this.requirePhone(dto.whatsappNumber, s);

    const result = await this.withDuplicateGuard(() =>
      this.db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await purgeUnverifiedPhoneAccount(txDb, phone);
        await assertWhatsappNumberAvailable(txDb, phone, s.defaultCountryCode);

        const userId = uuid();
        await tx.insert(users).values({
          id: userId,
          email: null,
          passwordHash: null,
          phone,
          phoneVerifiedAt: null,
          fullName: dto.fullName,
          role: 'PATIENT_GUARDIAN',
          isActive: true,
        });
        const patientId = uuid();
        await tx.insert(patients).values({
          id: patientId,
          userId,
          fullName: dto.fullName,
          phone,
          consentAcceptedAt: new Date(),
          // Every self-registered client starts unreviewed; staff promote it
          // to ACTIVE from the staff app.
          status: 'PENDING_REVIEW',
        });
        return { userId, patientId };
      }),
    );

    const dispatch = await this.sendRegistrationOtp(phone, s);
    return {
      patientId: result.patientId,
      userId: result.userId,
      phone: maskPhone(phone),
      message: this.registrationMessage(dispatch),
      ...dispatch,
    };
  }

  /**
   * Sends a code for REGISTER (re-send), LOGIN or RECOVERY. The response is
   * identical whether or not the number belongs to an account, and whether or
   * not a code was actually sent, so this can't be used to discover who is
   * registered - the same stance as /auth/resend-verification.
   */
  async requestOtp(dto: RequestWhatsappOtpDto) {
    const s = await this.settings.getResolved();
    this.assertAvailable(s, dto.purpose);
    const phone = this.requirePhone(dto.phone, s);

    const generic = {
      message: 'If this number is registered, a code has been sent to it on WhatsApp.',
      resendAfterSeconds: s.otpResendCooldownSeconds,
      expiresInSeconds: s.otpTtlSeconds,
    };

    const [user] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user || !this.isEligible(user, dto.purpose, s)) return generic;

    const issued = await this.otp.issue(phone, dto.purpose, s);
    if (!issued.issued) return generic;

    // Not awaited: a slow WhatsApp call must not make "registered" and "not
    // registered" distinguishable by response time.
    void this.provider.sendOtp(s, phone, issued.code).catch((err: Error) => this.logger.error(`OTP delivery failed: ${err.message}`));

    return { ...generic, ...(this.provider.isDevConsole(s) ? { devOtp: issued.code } : {}) };
  }

  /** Verifies a code and, on success, signs the user in (and, for REGISTER, activates the account). */
  async verifyOtp(dto: VerifyWhatsappOtpDto) {
    const s = await this.settings.getResolved();
    this.assertAvailable(s, dto.purpose);
    const phone = this.requirePhone(dto.phone, s);

    if (!(await this.otp.verify(phone, dto.purpose, dto.code))) {
      throw new UnauthorizedException(BAD_CODE);
    }

    const [user] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user || !this.isEligible(user, dto.purpose, s)) {
      throw new UnauthorizedException(BAD_CODE);
    }

    if (dto.purpose === 'REGISTER') {
      await this.db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, user.id));
    } else if (dto.purpose === 'RECOVERY') {
      // Recovering an account means "I may have lost control of it": every
      // existing session is cut off, and only this new one survives.
      await this.db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, user.id));
    }

    const tokens = await this.authService.startSession(user);
    return { tokens, userId: user.id, role: user.role };
  }

  // --- helpers -------------------------------------------------------------

  /**
   * REGISTER with `newSignup` is a fresh sign-up and honours the
   * "registration" toggle; REGISTER without it (resending/verifying a code for
   * a signup that already exists) only needs WhatsApp to be on, so turning off
   * new sign-ups never strands someone halfway through one.
   */
  private assertAvailable(s: ResolvedWhatsappSettings, purpose: WhatsappOtpPurpose, role?: UserRole, newSignup = false) {
    const purposeOn =
      purpose === 'REGISTER' ? (newSignup ? s.registrationEnabled : true) : purpose === 'LOGIN' ? s.loginEnabled : s.recoveryEnabled;
    const roleOn = role === undefined ? true : this.roleEnabled(s, role);
    if (!s.enabled || !purposeOn || !roleOn) {
      throw new ForbiddenException('WhatsApp sign-in is not available right now');
    }
  }

  private roleEnabled(s: ResolvedWhatsappSettings, role: UserRole): boolean {
    return role === 'CAREGIVER' ? s.caregiverEnabled : role === 'PATIENT_GUARDIAN' ? s.customerEnabled : false;
  }

  private isEligible(
    user: { role: UserRole; isActive: boolean; phoneVerifiedAt: Date | null },
    purpose: WhatsappOtpPurpose,
    s: ResolvedWhatsappSettings,
  ): boolean {
    if (!SELF_REGISTERED_ROLES.includes(user.role) || !user.isActive || !this.roleEnabled(s, user.role)) return false;
    return purpose === 'REGISTER' ? !user.phoneVerifiedAt : !!user.phoneVerifiedAt;
  }

  private requirePhone(input: string, s: ResolvedWhatsappSettings): string {
    const phone = normalizePhone(input, s.defaultCountryCode);
    if (!phone) throw new BadRequestException('Enter a valid WhatsApp number, including the country code if it is not a local number');
    return phone;
  }

  private async sendRegistrationOtp(phone: string, s: ResolvedWhatsappSettings): Promise<OtpDispatch> {
    const base = { resendAfterSeconds: s.otpResendCooldownSeconds, expiresInSeconds: s.otpTtlSeconds };
    const issued = await this.otp.issue(phone, 'REGISTER', s);
    if (!issued.issued) return { otpSent: false, ...base, resendAfterSeconds: issued.retryAfterSeconds };

    try {
      await this.provider.sendOtp(s, phone, issued.code);
    } catch (err) {
      // The account exists; the user can ask for another code. Don't fail the registration.
      this.logger.error(`Registration OTP delivery failed: ${(err as Error).message}`);
      return { otpSent: false, ...base };
    }
    return { otpSent: true, ...base, ...(this.provider.isDevConsole(s) ? { devOtp: issued.code } : {}) };
  }

  private registrationMessage(d: OtpDispatch): string {
    return d.otpSent
      ? 'Registration successful. Enter the code we sent to your WhatsApp to verify your number.'
      : 'Your account was created, but we could not send the WhatsApp code just now. Request a new code to verify your number.';
  }

  /** Two simultaneous sign-ups for one number race past the pre-checks; the unique index settles it. */
  private async withDuplicateGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('An account with this WhatsApp number already exists');
      }
      throw err;
    }
  }
}
