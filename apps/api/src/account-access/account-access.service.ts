import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { accountClaimCodes, caregivers, emailVerificationTokens, patients, socialAccounts, users, whatsappOtps, type SocialProvider } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { normalizePhone, phoneVariants } from '../common/utils/phone.util';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { AuthService } from '../auth/auth.service';
import { ClaimCodesService } from './claim-codes.service';
import { loadAccountState, voidOutstandingCredentials, type SignInMethods } from './identity.util';
import type { ResetSignInDto } from './dto/reset-sign-in.dto';
import type { ChangeCaregiverContactDto } from './dto/change-contact.dto';

export interface ContactChange {
  email: { from: string | null; to: string } | null;
  phone: { from: string | null; to: string } | null;
  /** A fresh verification link went to the new address (email + password accounts). */
  verificationSent: boolean;
  /** The login was created to hold the email (a staff-entered caregiver nobody had claimed). */
  loginCreated: boolean;
}

/**
 * The staff side of caregiver sign-in: see which methods an account has, take
 * some or all of them away, and issue a one-time code that lets the caregiver
 * set the account up again with their registration number.
 *
 * Deleting a caregiver is a different action (CaregiversService.remove): that
 * also releases the email, phone, NIC and provider identities so the person
 * can register afresh. A reset keeps the record and its history and only
 * changes how it is signed in to.
 */
@Injectable()
export class AccountAccessService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly claimCodes: ClaimCodesService,
    private readonly config: ConfigService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly auth: AuthService,
  ) {}

  async getSignInMethods(caregiverId: string): Promise<SignInMethods> {
    const caregiver = await this.findLiveCaregiver(caregiverId);
    const { user, links, claimable } = await loadAccountState(this.db, caregiver);
    return {
      hasAccount: Boolean(user),
      isActive: user?.isActive ?? false,
      email: user?.email ?? null,
      emailVerified: Boolean(user?.emailVerifiedAt),
      contactPhone: caregiver.primaryPhone,
      phone: user?.phone ?? null,
      phoneVerified: Boolean(user?.phoneVerifiedAt),
      hasPassword: Boolean(user?.passwordHash),
      providers: links,
      lastLoginAt: user?.lastLoginAt ?? null,
      claimable,
      staffClaimCodeExpiresAt: claimable ? await this.claimCodes.activeStaffCodeExpiry(caregiver.id) : null,
    };
  }

  /**
   * Removes the chosen sign-in methods. Whatever is chosen, every session is
   * revoked and every outstanding link or code is voided, so the change is in
   * force immediately.
   *
   * Returns the methods that remain plus a summary of what was removed, for the
   * audit log.
   */
  async resetSignIn(caregiverId: string, dto: ResetSignInDto) {
    const providers = dto.providers ?? [];
    if (!providers.length && !dto.password && !dto.phone && !dto.email) {
      throw new BadRequestException('Choose at least one sign-in method to reset');
    }

    const caregiver = await this.findLiveCaregiver(caregiverId);
    if (!caregiver.userId) {
      throw new BadRequestException('This caregiver has not set up a sign-in yet - there is nothing to reset');
    }
    const userId = caregiver.userId;

    const removed = await this.db.transaction(async (tx) => {
      const txDb = tx as unknown as Database;
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new BadRequestException('This caregiver has not set up a sign-in yet - there is nothing to reset');

      let unlinked: SocialProvider[] = [];
      if (providers.length) {
        const existing = await tx
          .select({ provider: socialAccounts.provider })
          .from(socialAccounts)
          .where(and(eq(socialAccounts.userId, userId), inArray(socialAccounts.provider, providers)));
        unlinked = existing.map((e) => e.provider);
        await tx.delete(socialAccounts).where(and(eq(socialAccounts.userId, userId), inArray(socialAccounts.provider, providers)));
      }

      const updates: Partial<typeof users.$inferInsert> = {};
      if (dto.password) updates.passwordHash = null;
      if (dto.phone) {
        updates.phone = null;
        updates.phoneVerifiedAt = null;
      }
      if (dto.email) {
        updates.email = null;
        updates.emailVerifiedAt = null;
      }
      if (Object.keys(updates).length) await tx.update(users).set(updates).where(eq(users.id, userId));

      await voidOutstandingCredentials(txDb, { userId, caregiverId: caregiver.id, phone: user.phone });

      return {
        providers: unlinked,
        password: Boolean(dto.password && user.passwordHash),
        phone: dto.phone ? user.phone : null,
        email: dto.email ? user.email : null,
      };
    });

    return { methods: await this.getSignInMethods(caregiver.id), removed };
  }

  /**
   * Corrects the email address and/or phone number a caregiver is reached on -
   * the usual fix for a registration abandoned over a typo: a claim code or
   * verification link went to an address that isn't theirs, or Google/Microsoft
   * /Facebook refused to link because the registered email didn't match theirs.
   *
   * - Email: written to the login (created if a staff-entered caregiver has none
   *   yet, so the claim code can be emailed). It is unverified until proven
   *   again; an email + password account gets a fresh verification link.
   * - Phone: written to the caregiver record (what claim codes, search and the
   *   staff list use) and to the login's WhatsApp number, unverified until a
   *   code to it is entered.
   *
   * Codes and links already sent to the old details stop working. Sessions are
   * kept: this changes how the caregiver is reached, not who may sign in.
   *
   * Staff may correct an account that is not secured yet (no provider, no
   * password) - the same accounts they may issue claim codes for. Changing
   * the contact details of an account that already signs in is for admins.
   */
  async changeContact(caregiverId: string, dto: ChangeCaregiverContactDto, actor: AuthenticatedUser): Promise<{ methods: SignInMethods; change: ContactChange }> {
    if (dto.email === undefined && dto.phone === undefined) throw new BadRequestException('Enter a new email address or phone number');
    const caregiver = await this.findLiveCaregiver(caregiverId);
    const state = await loadAccountState(this.db, caregiver);
    if (actor.role !== 'ADMIN' && !state.claimable) {
      throw new ForbiddenException('This caregiver can already sign in - only an admin can change their email address or phone number');
    }

    const countryCode = await this.whatsappSettings.getDefaultCountryCode();
    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone !== undefined ? normalizePhone(dto.phone, countryCode) : undefined;
    if (dto.phone !== undefined && !phone) throw new BadRequestException('Enter a valid phone number');

    const change: ContactChange = { email: null, phone: null, verificationSent: false, loginCreated: false };
    let sendVerificationTo: string | null = null;

    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Database;
      // Re-read inside the transaction: the caregiver may have finished their
      // account in the meantime.
      let user = state.user ? (await t.select().from(users).where(eq(users.id, state.user.id)).limit(1))[0] ?? null : null;

      if (email !== undefined && email !== (user?.email ?? '').toLowerCase()) {
        const [taken] = await t
          .select({ id: users.id })
          .from(users)
          .where(user ? and(eq(users.email, email), ne(users.id, user.id)) : eq(users.email, email))
          .limit(1);
        if (taken) throw new ConflictException('Another account already uses this email address');
        if (!user) {
          // A staff-entered caregiver nobody has claimed: the login the claim
          // would create, created now so the claim code can go to this address.
          // No password and no provider, so it stays claimable.
          const id = uuid();
          await t.insert(users).values({ id, email, fullName: caregiver.fullName, role: 'CAREGIVER', isActive: true });
          await t.update(caregivers).set({ userId: id }).where(eq(caregivers.id, caregiver.id));
          change.loginCreated = true;
          user = (await t.select().from(users).where(eq(users.id, id)).limit(1))[0];
        } else {
          await t.update(users).set({ email, emailVerifiedAt: null }).where(eq(users.id, user.id));
          // Links and email codes sent to the old address must not verify the new one.
          await t
            .update(emailVerificationTokens)
            .set({ usedAt: new Date() })
            .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)));
          await t
            .update(accountClaimCodes)
            .set({ consumedAt: new Date() })
            .where(and(eq(accountClaimCodes.caregiverId, caregiver.id), eq(accountClaimCodes.channel, 'EMAIL'), isNull(accountClaimCodes.consumedAt)));
          if (user.passwordHash) sendVerificationTo = user.id;
        }
        change.email = { from: state.user?.email ?? null, to: email };
      }

      if (phone) {
        const current = normalizePhone(caregiver.primaryPhone, countryCode);
        if (phone !== current || (user && user.phone && user.phone !== phone)) {
          await this.assertPhoneFree(t, phone, countryCode, caregiver.id, user?.id ?? null);
          await t.update(caregivers).set({ primaryPhone: phone }).where(eq(caregivers.id, caregiver.id));
          if (user) {
            await t.update(users).set({ phone, phoneVerifiedAt: null }).where(eq(users.id, user.id));
            // A WhatsApp code already sent to the old number must not be usable.
            if (user.phone) {
              await t.update(whatsappOtps).set({ consumedAt: new Date() }).where(and(eq(whatsappOtps.phone, user.phone), isNull(whatsappOtps.consumedAt)));
            }
          }
          if (current) {
            await t.update(whatsappOtps).set({ consumedAt: new Date() }).where(and(eq(whatsappOtps.phone, current), isNull(whatsappOtps.consumedAt)));
          }
          change.phone = { from: caregiver.primaryPhone, to: phone };
        }
      }
    });

    if (!change.email && !change.phone) throw new BadRequestException('Those are already the caregiver\'s details - nothing to change');
    if (sendVerificationTo) change.verificationSent = await this.auth.sendVerificationLink(sendVerificationTo);
    return { methods: await this.getSignInMethods(caregiver.id), change };
  }

  /**
   * A phone number may belong to one person: no other login, caregiver record
   * or client may hold any spelling of it. This caregiver's own rows don't count.
   */
  private async assertPhoneFree(db: Database, e164: string, countryCode: string, caregiverId: string, userId: string | null) {
    const variants = phoneVariants(e164, countryCode);
    const [login] = await db
      .select({ id: users.id })
      .from(users)
      .where(userId ? and(eq(users.phone, e164), ne(users.id, userId)) : eq(users.phone, e164))
      .limit(1);
    const [record] = await db
      .select({ id: caregivers.id })
      .from(caregivers)
      .where(and(inArray(caregivers.livePrimaryPhone, variants), ne(caregivers.id, caregiverId)))
      .limit(1);
    const [client] = await db.select({ id: patients.id }).from(patients).where(inArray(patients.phone, variants)).limit(1);
    if (login || record || client) throw new ConflictException('Another account already uses this phone number');
  }

  /**
   * A code staff hand to the caregiver after checking who they are themselves -
   * for someone who no longer has the phone on file and has no email. Shown to
   * staff once; only its hash is stored. Issuing a new one cancels the last.
   */
  async issueStaffClaimCode(caregiverId: string, issuedBy: string) {
    const caregiver = await this.findLiveCaregiver(caregiverId);
    const { claimable } = await loadAccountState(this.db, caregiver);
    if (!claimable) {
      throw new BadRequestException(
        'This caregiver can already sign in. Reset their sign-in methods first, then issue a code.',
      );
    }
    const issued = await this.claimCodes.issue(caregiver.id, 'STAFF', issuedBy);
    if (!issued.issued) {
      // STAFF codes have no cooldown, so this cannot happen; kept for the type.
      throw new BadRequestException('Please wait a moment before issuing another code');
    }
    return {
      code: issued.code,
      expiresAt: issued.expiresAt,
      registrationNumber: caregiver.registrationNumber,
      claimUrl: this.claimUrl(),
    };
  }

  /**
   * Where the caregiver enters the code: the claim page on the public site
   * (apps/public-web), e.g. https://find.caregivers.lk/caregiver/claim. Staff
   * read it out or write it down with the code, so it comes from the same
   * PUBLIC_WEB_URL the API already uses for public-site links.
   */
  private claimUrl(): string {
    const base = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '');
    return `${base}/caregiver/claim`;
  }

  private async findLiveCaregiver(caregiverId: string) {
    const [caregiver] = await this.db
      .select({
        id: caregivers.id,
        userId: caregivers.userId,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        primaryPhone: caregivers.primaryPhone,
        deletedAt: caregivers.deletedAt,
      })
      .from(caregivers)
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    if (!caregiver || caregiver.deletedAt) throw new NotFoundException('Caregiver not found');
    return caregiver;
  }
}
