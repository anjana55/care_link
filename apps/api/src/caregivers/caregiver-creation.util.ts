import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers } from '../database/schema';

/**
 * Accepts either the top-level Database handle or a transaction handle from
 * db.transaction(async (tx) => ...) - both expose the same query-builder
 * surface for the read-only operations these helpers need.
 */
export async function generateRegistrationNumber(db: Database): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.floor(100000 + Math.random() * 900000);
    const candidate = `CG-${year}-${suffix}`;
    const [existing] = await db.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.registrationNumber, candidate)).limit(1);
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate a unique registration number, please retry');
}

export async function assertUniqueContactFields(
  db: Database,
  fields: { nic?: string | null; passportNumber?: string | null; primaryPhone?: string },
  excludeId?: string,
): Promise<void> {
  const checks: Promise<void>[] = [];

  if (fields.nic) {
    checks.push(
      db
        .select({ id: caregivers.id })
        .from(caregivers)
        .where(eq(caregivers.nic, fields.nic))
        .limit(1)
        .then(([row]) => {
          if (row && row.id !== excludeId) throw new ConflictException('A caregiver with this NIC already exists');
        }),
    );
  }
  if (fields.passportNumber) {
    checks.push(
      db
        .select({ id: caregivers.id })
        .from(caregivers)
        .where(eq(caregivers.passportNumber, fields.passportNumber))
        .limit(1)
        .then(([row]) => {
          if (row && row.id !== excludeId) throw new ConflictException('A caregiver with this passport number already exists');
        }),
    );
  }
  if (fields.primaryPhone) {
    checks.push(
      db
        .select({ id: caregivers.id })
        .from(caregivers)
        .where(eq(caregivers.primaryPhone, fields.primaryPhone))
        .limit(1)
        .then(([row]) => {
          if (row && row.id !== excludeId) throw new ConflictException('A caregiver with this phone number already exists');
        }),
    );
  }

  await Promise.all(checks);
}
