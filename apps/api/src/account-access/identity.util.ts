import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import {
  accountClaimCodes,
  authHandoffCodes,
  caregivers,
  emailVerificationTokens,
  refreshTokens,
  socialAccounts,
  users,
  whatsappOtps,
  type SocialProvider,
} from '../database/schema';

/**
 * Every outstanding credential that could still turn into a session for this
 * login: refresh tokens, unspent social handoff codes, email verification
 * links, unused claim codes and any WhatsApp code sent to its number.
 *
 * Called after anything that changes who may sign in to an account (a staff
 * reset, a deletion), so the change takes effect immediately rather than when
 * the last token happens to expire.
 */
export async function voidOutstandingCredentials(
  db: Database,
  params: { userId: string | null; caregiverId: string; phone?: string | null },
): Promise<void> {
  const now = new Date();
  if (params.userId) {
    await db.update(refreshTokens).set({ revoked: true }).where(eq(refreshTokens.userId, params.userId));
    await db
      .update(authHandoffCodes)
      .set({ usedAt: now })
      .where(and(eq(authHandoffCodes.userId, params.userId), isNull(authHandoffCodes.usedAt)));
    await db
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(and(eq(emailVerificationTokens.userId, params.userId), isNull(emailVerificationTokens.usedAt)));
  }
  await db
    .update(accountClaimCodes)
    .set({ consumedAt: now })
    .where(and(eq(accountClaimCodes.caregiverId, params.caregiverId), isNull(accountClaimCodes.consumedAt)));
  if (params.phone) {
    await db
      .update(whatsappOtps)
      .set({ consumedAt: now })
      .where(and(eq(whatsappOtps.phone, params.phone), isNull(whatsappOtps.consumedAt)));
  }
}

export interface ReleasedIdentity {
  releasedEmail: string | null;
  releasedPhone: string | null;
  unlinkedProviders: SocialProvider[];
}

/**
 * What deleting a caregiver does to their login.
 *
 * The caregiver row is soft-deleted and kept; the login is not deleted either
 * (audit rows and documents point at it), but it is made inert and stripped of
 * everything that identifies a person to the sign-in flows:
 *
 * - deactivated, so the JWT strategy refuses any access token still in flight;
 * - email, phone and password hash cleared, so the same address or number can
 *   register again (users.email / users.phone are UNIQUE);
 * - provider links deleted, so the same Google/Microsoft/Facebook account can
 *   be linked again - and so it can no longer sign in to this record;
 * - every outstanding token voided.
 *
 * Returns what was released, for the audit log - the only place it survives.
 */
export async function releaseCaregiverIdentity(
  db: Database,
  params: { caregiverId: string; userId: string | null },
): Promise<ReleasedIdentity> {
  const released: ReleasedIdentity = { releasedEmail: null, releasedPhone: null, unlinkedProviders: [] };

  if (params.userId) {
    const [user] = await db
      .select({ email: users.email, phone: users.phone })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const links = await db
      .select({ provider: socialAccounts.provider })
      .from(socialAccounts)
      .where(eq(socialAccounts.userId, params.userId));

    released.releasedEmail = user?.email ?? null;
    released.releasedPhone = user?.phone ?? null;
    released.unlinkedProviders = links.map((l) => l.provider);

    await voidOutstandingCredentials(db, { userId: params.userId, caregiverId: params.caregiverId, phone: user?.phone });
    await db.delete(socialAccounts).where(eq(socialAccounts.userId, params.userId));
    await db
      .update(users)
      .set({
        isActive: false,
        email: null,
        phone: null,
        passwordHash: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
      })
      .where(eq(users.id, params.userId));
  } else {
    await voidOutstandingCredentials(db, { userId: null, caregiverId: params.caregiverId });
  }

  return released;
}

export interface SignInMethods {
  /** False for a staff-entered caregiver nobody has claimed yet. */
  hasAccount: boolean;
  isActive: boolean;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  hasPassword: boolean;
  providers: { provider: SocialProvider; providerEmail: string; linkedAt: Date }[];
  lastLoginAt: Date | null;
  /** True when the caregiver may finish the account with their registration number. */
  claimable: boolean;
  /** Expiry of the newest unused staff-issued claim code, if any. */
  staffClaimCodeExpiresAt: Date | null;
}

/**
 * The rule for "this account was registered but never secured": nothing that
 * proves who owns it has been attached. A provider link or a password is such
 * a proof; a verified phone on its own is not counted, because the claim flow
 * re-proves exactly that phone before it lets anything else be attached.
 *
 * A caregiver with no login at all (staff-entered) is claimable too - claiming
 * is what creates it.
 */
export function isClaimable(params: {
  caregiverDeleted: boolean;
  user: { isActive: boolean; role: string; passwordHash: string | null } | null;
  linkedProviderCount: number;
}): boolean {
  if (params.caregiverDeleted) return false;
  if (!params.user) return true;
  if (!params.user.isActive || params.user.role !== 'CAREGIVER') return false;
  return !params.user.passwordHash && params.linkedProviderCount === 0;
}

/** Loads a caregiver's login, its provider links and whether it can be claimed. */
export async function loadAccountState(db: Database, caregiver: { id: string; userId: string | null; deletedAt: Date | null }) {
  const [user] = caregiver.userId
    ? await db.select().from(users).where(eq(users.id, caregiver.userId)).limit(1)
    : [];
  const links = caregiver.userId
    ? await db
        .select({
          provider: socialAccounts.provider,
          providerEmail: socialAccounts.providerEmail,
          linkedAt: socialAccounts.createdAt,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.userId, caregiver.userId))
    : [];
  const claimable = isClaimable({
    caregiverDeleted: Boolean(caregiver.deletedAt),
    user: user ?? null,
    linkedProviderCount: links.length,
  });
  return { user: user ?? null, links, claimable };
}

/** The caregivers row for a registration number, deleted or not. */
export async function findCaregiverByRegistrationNumber(db: Database, registrationNumber: string) {
  const [row] = await db
    .select({
      id: caregivers.id,
      userId: caregivers.userId,
      fullName: caregivers.fullName,
      primaryPhone: caregivers.primaryPhone,
      registrationNumber: caregivers.registrationNumber,
      deletedAt: caregivers.deletedAt,
    })
    .from(caregivers)
    .where(eq(caregivers.registrationNumber, registrationNumber))
    .limit(1);
  return row ?? null;
}

/**
 * Normalises what people type for a registration number. Numbers look like
 * CG-2026-123456, but they get read off a phone screen or a printout and typed
 * back as "cg 2026 123456", "CG2026123456" or with an en dash; all of those mean
 * the same record.
 */
export function normaliseRegistrationNumber(input: string): string {
  const upper = (input ?? '').trim().toUpperCase();
  const m = /^CG\W*(\d{4})\W*(\d{4,8})$/.exec(upper.replace(/[\u2010-\u2015]/g, '-'));
  return m ? `CG-${m[1]}-${m[2]}` : upper;
}
