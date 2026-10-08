import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, socialAccounts, users, type SocialProvider } from '../database/schema';
import { ClaimCodesService } from './claim-codes.service';
import { loadAccountState, voidOutstandingCredentials, type SignInMethods } from './identity.util';
import type { ResetSignInDto } from './dto/reset-sign-in.dto';

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
  ) {}

  async getSignInMethods(caregiverId: string): Promise<SignInMethods> {
    const caregiver = await this.findLiveCaregiver(caregiverId);
    const { user, links, claimable } = await loadAccountState(this.db, caregiver);
    return {
      hasAccount: Boolean(user),
      isActive: user?.isActive ?? false,
      email: user?.email ?? null,
      emailVerified: Boolean(user?.emailVerifiedAt),
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
    return { code: issued.code, expiresAt: issued.expiresAt, registrationNumber: caregiver.registrationNumber };
  }

  private async findLiveCaregiver(caregiverId: string) {
    const [caregiver] = await this.db
      .select({
        id: caregivers.id,
        userId: caregivers.userId,
        registrationNumber: caregivers.registrationNumber,
        deletedAt: caregivers.deletedAt,
      })
      .from(caregivers)
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    if (!caregiver || caregiver.deletedAt) throw new NotFoundException('Caregiver not found');
    return caregiver;
  }
}
