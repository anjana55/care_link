import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers, patients, refreshTokens, users } from '../database/schema';
import { phoneVariants } from '../common/utils/phone.util';

const SELF_REGISTERED = ['CAREGIVER', 'PATIENT_GUARDIAN'] as const;

/**
 * Before creating a WhatsApp account for `phone`, clears out a previous
 * registration for the same number that never completed its OTP.
 *
 * Nobody has proven they own the number on such a row, so letting it block the
 * real owner would let anyone squat on someone else's phone by registering
 * with it. Only a pristine DRAFT self-registration is removed - an unverified
 * row can't have signed in, so nothing hangs off it - anything else is left
 * alone and surfaces as a normal conflict.
 */
export async function purgeUnverifiedPhoneAccount(db: Database, phone: string): Promise<void> {
  const stale = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.phoneVerifiedAt), inArray(users.role, [...SELF_REGISTERED])));

  for (const { id } of stale) {
    const [profile] = await db.select({ status: caregivers.status }).from(caregivers).where(eq(caregivers.userId, id)).limit(1);
    if (profile && profile.status !== 'DRAFT') continue;
    await db.delete(caregivers).where(eq(caregivers.userId, id));
    await db.delete(patients).where(eq(patients.userId, id));
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
}

/**
 * Rejects a WhatsApp registration when the number is already attached to any
 * account, whichever way that account was created: another WhatsApp login, a
 * caregiver profile (including ones staff entered), or a customer profile.
 * Compares every stored spelling, since phone columns hold free text.
 */
export async function assertWhatsappNumberAvailable(db: Database, e164: string, defaultCountryCode: string): Promise<void> {
  const variants = phoneVariants(e164, defaultCountryCode);

  const [byLogin] = await db.select({ id: users.id }).from(users).where(eq(users.phone, e164)).limit(1);
  if (byLogin) throw new ConflictException('An account with this WhatsApp number already exists');

  const [byCaregiver] = await db.select({ id: caregivers.id }).from(caregivers).where(inArray(caregivers.primaryPhone, variants)).limit(1);
  if (byCaregiver) throw new ConflictException('An account with this phone number already exists');

  const [byPatient] = await db.select({ id: patients.id }).from(patients).where(inArray(patients.phone, variants)).limit(1);
  if (byPatient) throw new ConflictException('An account with this phone number already exists');
}

/**
 * Used by the *email* registration paths: if the phone they were given is
 * already a WhatsApp login, that person already has an account - sign in with
 * WhatsApp rather than minting a second identity for the same number.
 */
export async function assertNoWhatsappLoginForPhone(db: Database, e164: string | null): Promise<void> {
  if (!e164) return;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.phone, e164)).limit(1);
  if (existing) {
    throw new ConflictException('An account with this phone number already exists - sign in with WhatsApp instead');
  }
}
