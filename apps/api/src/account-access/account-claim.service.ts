import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { accountClaimCodes, caregivers, users } from '../database/schema';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappOtpService } from '../whatsapp/whatsapp-otp.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { EmailService } from '../email/email.service';
import { SocialAuthService } from '../auth/social-auth.service';
import { normalizePhone } from '../common/utils/phone.util';
import { ClaimCodesService, CLAIM_CODE_POLICY } from './claim-codes.service';
import { findCaregiverByRegistrationNumber, loadAccountState, normaliseRegistrationNumber } from './identity.util';

/** One answer for every outcome of a start request, so it cannot be used to test registration numbers. */
const CLAIM_STARTED = 'If this registration can be finished online, we have sent a code to the phone number or email address on it.';
/** One answer for every failed verification - wrong code, expired, unknown number, already secured. */
const CLAIM_REJECTED = 'This code is invalid or has expired. Request a new one and try again.';
const CLAIM_ACCEPTED = 'Code accepted. Sign in with Google, Microsoft or Facebook to finish setting up your account.';

export type ClaimChannel = 'WHATSAPP' | 'EMAIL' | 'STAFF';

/**
 * "Sign in with my registration number": for a caregiver who submitted the
 * registration form but never secured the account - skipped the provider step,
 * let the 15-minute link expire, had a staff member reset their sign-in - and
 * for a staff-entered caregiver who never had a login at all.
 *
 * A registration number is not a secret (it is printed, shown on screens, and
 * follows a guessable pattern), so it only says *which* record. What proves the
 * record is theirs is a code sent to the contact details already on it - by
 * WhatsApp to the phone on the caregiver record, or by email to the address on
 * the login - or a code a staff member issued after checking who they are.
 *
 * A correct code buys nothing more than the end of the registration form does:
 * the same 15-minute pending token, which can only be used to link one
 * Google/Microsoft/Facebook identity through SocialAuthService.completeLink,
 * with all of that method's checks (email match, identity not already used).
 * No session is issued here.
 */
@Injectable()
export class AccountClaimService {
  private readonly logger = new Logger(AccountClaimService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly otp: WhatsappOtpService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly email: EmailService,
    private readonly claimCodes: ClaimCodesService,
    private readonly socialAuth: SocialAuthService,
  ) {}

  async start(rawRegistrationNumber: string): Promise<{ message: string; resendAfterSeconds: number; devCode?: string }> {
    const generic = { message: CLAIM_STARTED, resendAfterSeconds: 60 };

    const caregiver = await findCaregiverByRegistrationNumber(this.db, normaliseRegistrationNumber(rawRegistrationNumber));
    if (!caregiver) return generic;
    const { user, claimable } = await loadAccountState(this.db, caregiver);
    if (!claimable) return generic;

    // WhatsApp first: the phone number is the one contact detail every
    // registration route collects, and it is what staff keep up to date.
    const s = await this.whatsappSettings.getResolved();
    const phone = normalizePhone(caregiver.primaryPhone, s.defaultCountryCode);
    if (s.enabled && s.caregiverEnabled && phone) {
      const issued = await this.otp.issue(phone, 'CLAIM', s);
      if (!issued.issued) return { ...generic, resendAfterSeconds: issued.retryAfterSeconds };
      // Not awaited, as in WhatsappAuthService.requestOtp: a slow provider call
      // must not make "sent" and "nothing to send" distinguishable by timing.
      void this.whatsapp
        .sendOtp(s, phone, issued.code)
        .catch((err: Error) => this.logger.error(`Claim code delivery failed: ${err.message}`));
      return { ...generic, resendAfterSeconds: s.otpResendCooldownSeconds, ...(this.whatsapp.isDevConsole(s) ? { devCode: issued.code } : {}) };
    }

    if (user?.email) {
      const issued = await this.claimCodes.issue(caregiver.id, 'EMAIL');
      if (!issued.issued) return { ...generic, resendAfterSeconds: issued.retryAfterSeconds };
      void this.email.sendClaimCodeEmail(
        user.email,
        issued.code,
        caregiver.registrationNumber,
        CLAIM_CODE_POLICY.EMAIL.ttlMs / 60_000,
      );
      return { ...generic, ...(this.isProduction() ? {} : { devCode: issued.code }) };
    }

    // Nothing to send to. The person can still use a staff-issued code, which
    // the page offers alongside this message.
    return generic;
  }

  async verify(rawRegistrationNumber: string, rawCode: string) {
    const caregiver = await findCaregiverByRegistrationNumber(this.db, normaliseRegistrationNumber(rawRegistrationNumber));
    if (!caregiver) throw new UnauthorizedException(CLAIM_REJECTED);
    const { user, claimable } = await loadAccountState(this.db, caregiver);
    if (!claimable) throw new UnauthorizedException(CLAIM_REJECTED);

    const s = await this.whatsappSettings.getResolved();
    const phone = normalizePhone(caregiver.primaryPhone, s.defaultCountryCode);

    let channel: ClaimChannel | null = await this.claimCodes.verify(caregiver.id, rawCode);
    if (!channel && phone && !ClaimCodesService.looksLikeStaffCode(rawCode)) {
      if (await this.otp.verify(phone, 'CLAIM', ClaimCodesService.canonical(rawCode))) channel = 'WHATSAPP';
    }
    if (!channel) throw new UnauthorizedException(CLAIM_REJECTED);

    const userId = await this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const now = new Date();
      // A phone just proven over WhatsApp becomes the login's number - unless
      // some other login already holds it, in which case it is left alone
      // rather than stolen; the claim still succeeds.
      const provenPhone =
        channel === 'WHATSAPP' && phone && !(await this.phoneHeldByAnotherLogin(txDb, phone, user?.id)) ? phone : null;

      if (!user) {
        // A staff-entered caregiver: claiming is what gives them a login.
        const newUserId = uuid();
        await tx.insert(users).values({
          id: newUserId,
          email: null,
          passwordHash: null,
          phone: provenPhone,
          phoneVerifiedAt: provenPhone ? now : null,
          fullName: caregiver.fullName,
          role: 'CAREGIVER',
          isActive: true,
          emailVerifiedAt: null,
        });
        await tx
          .update(caregivers)
          .set({ userId: newUserId })
          .where(and(eq(caregivers.id, caregiver.id), isNull(caregivers.userId)));
        return newUserId;
      }

      const updates: Partial<typeof users.$inferInsert> = {};
      if (provenPhone) {
        updates.phone = provenPhone;
        updates.phoneVerifiedAt = now;
      }
      if (channel === 'EMAIL') updates.emailVerifiedAt = now;
      if (Object.keys(updates).length) await tx.update(users).set(updates).where(eq(users.id, user.id));
      return user.id;
    });

    // Every other outstanding code for this record stops working.
    await this.db
      .update(accountClaimCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(accountClaimCodes.caregiverId, caregiver.id), isNull(accountClaimCodes.consumedAt)));

    const grant = await this.socialAuth.pendingLinkGrant(userId);
    return {
      message: CLAIM_ACCEPTED,
      caregiverId: caregiver.id,
      registrationNumber: caregiver.registrationNumber,
      channel,
      ...grant,
    };
  }

  private async phoneHeldByAnotherLogin(db: Database, phone: string, ownUserId?: string): Promise<boolean> {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(ownUserId ? and(eq(users.phone, phone), ne(users.id, ownUserId)) : eq(users.phone, phone))
      .limit(1);
    return Boolean(row);
  }

  private isProduction() {
    return this.config.get<string>('NODE_ENV') === 'production';
  }
}
