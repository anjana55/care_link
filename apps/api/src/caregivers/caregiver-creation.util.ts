import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers, locations } from '../database/schema';
import type { CreateCaregiverDto } from './dto/create-caregiver.dto';

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

/**
 * A caregiver's district/city pair has to exist in the `locations` reference
 * table. The city dropdown is derived from the selected district, so a city
 * belonging to a *different* district is always either a client bug or a
 * hand-rolled request - and storing one produces a record the district-scoped
 * filters in public-search can never match. Reject it at the boundary instead.
 *
 * Only enforced when both are supplied: a district with no city (or vice versa)
 * is still meaningful on its own, and is how the column is nullable on the row.
 * Callers doing a partial update must pass the *effective* pair - the incoming
 * value where present, otherwise what is already stored on the record.
 */
export async function assertKnownLocationPair(
  db: Database,
  fields: { district?: string | null; city?: string | null },
): Promise<void> {
  const district = fields.district?.trim();
  const city = fields.city?.trim();
  if (!district || !city) return;

  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.district, district), eq(locations.city, city)))
    .limit(1);

  if (!row) {
    throw new BadRequestException(`Unknown district/city combination: '${district}' / '${city}'`);
  }
}

/**
 * The `caregivers` row a self-registration creates, shared by the email and
 * WhatsApp sign-up paths so the two can never drift apart. Always DRAFT,
 * always consented (the DTO already enforced that), and always owned by the
 * login that created it.
 */
export function selfRegisteredCaregiverValues(params: {
  id: string;
  publicId: string;
  userId: string;
  registrationNumber: string;
  fields: CreateCaregiverDto;
}): typeof caregivers.$inferInsert {
  const { id, publicId, userId, registrationNumber, fields } = params;
  return {
    id,
    publicId,
    userId,
    registrationNumber,
    fullName: fields.fullName,
    permanentAddress: fields.permanentAddress,
    nic: fields.nic ?? null,
    passportNumber: fields.passportNumber ?? null,
    dateOfBirth: fields.dateOfBirth as unknown as Date,
    gender: fields.gender,
    civilStatus: fields.civilStatus,
    heightIn: fields.heightIn ?? null,
    weightKg: fields.weightKg ?? null,
    primaryPhone: fields.primaryPhone,
    secondaryPhone: fields.secondaryPhone ?? null,
    emergencyContactName: fields.emergencyContactName,
    emergencyContactNumber: fields.emergencyContactNumber,
    emergencyContactRelationship: fields.emergencyContactRelationship,
    policeDivision: fields.policeDivision ?? null,
    policeStation: fields.policeStation ?? null,
    district: fields.district ?? null,
    city: fields.city ?? null,
    postalCode: fields.postalCode ?? null,
    status: 'DRAFT',
    // Visible to staff immediately, same as a staff-entered DRAFT
    // record - self-registration doesn't hide anyone from the ops view.
    consentAcceptedAt: new Date(),
  };
}
