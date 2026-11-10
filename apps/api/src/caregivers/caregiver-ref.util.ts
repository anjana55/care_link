import { randomUUID as uuid } from 'crypto';
import { like, sql, type SQL } from 'drizzle-orm';
import { CAREGIVER_REF_LENGTH, caregiverRefSearchPrefix } from '@care-platform/shared';
import { caregivers } from '../database/schema';

/**
 * Extra OR-branch for a staff search box: matches caregivers by the short ID
 * customers see ("Caregiver abcd1234"), a full public id or a pasted profile
 * link. Undefined when the term doesn't look like an ID, so callers can
 * spread it into `or(...)` unconditionally:
 *
 *   or(like(caregivers.fullName, term), ...caregiverRefCondition(search))
 */
export function caregiverRefCondition(search: string | null | undefined): SQL[] {
  const prefix = caregiverRefSearchPrefix(search);
  return prefix ? [like(caregivers.publicId, `${prefix}%`)] : [];
}

/** Anything with a `select` builder - the db, or a transaction. */
type Selectable = { select: (...args: any[]) => any };

/**
 * A new `public_id` whose short ID (first CAREGIVER_REF_LENGTH characters)
 * no other caregiver has, so the ID a customer reads out over the phone
 * points at one caregiver. With 4 billion possible refs a retry is rare;
 * the loop only guards against the birthday-paradox case as the list grows.
 * The column's UNIQUE constraint still protects the full value.
 */
export async function generateUniquePublicId(db: Selectable, attempts = 10): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = uuid();
    const ref = candidate.slice(0, CAREGIVER_REF_LENGTH);
    const taken = await db
      .select({ n: sql<number>`1` })
      .from(caregivers)
      .where(like(caregivers.publicId, `${ref}%`))
      .limit(1);
    if (!taken.length) return candidate;
  }
  throw new Error('Could not generate a unique caregiver public id');
}
