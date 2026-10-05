import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers, patients, refreshTokens, socialAccounts, users } from '../database/schema';
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
    // A caregiver who signed up through the unified form and then proved who
    // they are with Google/Microsoft/Facebook has an unverified *phone* but a
    // verified *identity*, and phoneVerifiedAt stays null by design on that
    // route. Purging them would let a later WhatsApp signup for the same number
    // silently delete the account they just secured - so a linked provider
    // identity exempts the row, exactly as a non-DRAFT profile does.
    const [linked] = await db.select({ id: socialAccounts.id }).from(socialAccounts).where(eq(socialAccounts.userId, id)).limit(1);
    if (linked) continue;

    const [profile] = await db.select({ status: caregivers.status }).from(caregivers).where(eq(caregivers.userId, id)).limit(1);
    if (profile && profile.status !== 'DRAFT') continue;
    await db.delete(caregivers).where(eq(caregivers.userId, id));
    await db.delete(patients).where(eq(patients.userId, id));
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }
}

/**
 * Narrowing for an EDIT rather than a registration. On registration the caller
 * is anonymous and the number must belong to nobody; on an edit the caller is
 * staff and the two rows about to be written would otherwise match themselves -
 * the users row always, and the patients row whenever the value already stored
 * is one of the spellings of the number being written (always, since we write
 * the text as typed).
 *
 * Both exclusions are needed and they are different tables' keys, which is why
 * this is an object rather than the single excludeId that
 * assertUniqueContactFields takes - that one only ever queries `caregivers`.
 */
export interface PhoneAvailabilityExclusions {
  /** users.id to ignore - the login being edited. */
  userId?: string;
  /** patients.id to ignore - the profile being edited. */
  patientId?: string;
}

/**
 * Rejects a WhatsApp registration when the number is already attached to any
 * account, whichever way that account was created: another WhatsApp login, a
 * caregiver profile (including ones staff entered), or a customer profile.
 * Compares every stored spelling, since phone columns hold free text.
 */
export async function assertWhatsappNumberAvailable(
  db: Database,
  e164: string,
  defaultCountryCode: string,
  exclude: PhoneAvailabilityExclusions = {},
): Promise<void> {
  const variants = phoneVariants(e164, defaultCountryCode);

  const [byLogin] = await db
    .select({ id: users.id })
    .from(users)
    .where(exclude.userId ? and(eq(users.phone, e164), ne(users.id, exclude.userId)) : eq(users.phone, e164))
    .limit(1);
  if (byLogin) throw new ConflictException('An account with this WhatsApp number already exists');

  // Never excluded: a clients PATIENT_GUARDIAN login has no caregivers row, so
  // a hit here is always a genuine collision.
  const [byCaregiver] = await db.select({ id: caregivers.id }).from(caregivers).where(inArray(caregivers.primaryPhone, variants)).limit(1);
  if (byCaregiver) throw new ConflictException('An account with this phone number already exists');

  const [byPatient] = await db
    .select({ id: patients.id })
    .from(patients)
    .where(
      exclude.patientId
        ? and(inArray(patients.phone, variants), ne(patients.id, exclude.patientId))
        : inArray(patients.phone, variants),
    )
    .limit(1);
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
