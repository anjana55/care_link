import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers } from '../database/schema';
import type { ResolvedLocation } from '../common/utils/location.util';
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

/**
 * Uniqueness is checked against the live_* columns, which are NULL on a
 * soft-deleted caregiver - so a deleted record never blocks the same NIC,
 * passport or phone being registered again, and the check agrees exactly with
 * the unique indexes that back it.
 */
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
        .where(eq(caregivers.liveNic, fields.nic))
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
        .where(eq(caregivers.livePassportNumber, fields.passportNumber))
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
        .where(eq(caregivers.livePrimaryPhone, fields.primaryPhone))
        .limit(1)
        .then(([row]) => {
          if (row && row.id !== excludeId) throw new ConflictException('A caregiver with this phone number already exists');
        }),
    );
  }

  await Promise.all(checks);
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
  /** Already resolved from fields.districtId/cityId by the caller. */
  location: ResolvedLocation | null;
}): typeof caregivers.$inferInsert {
  const { id, publicId, userId, registrationNumber, fields, location } = params;
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
    districtId: location?.districtId ?? null,
    cityId: location?.cityId ?? null,
    district: location?.district ?? null,
    city: location?.city ?? null,
    postalCode: location?.postalCode ?? null,
    status: 'DRAFT',
    // Visible to staff immediately, same as a staff-entered DRAFT
    // record - self-registration doesn't hide anyone from the ops view.
    consentAcceptedAt: new Date(),
  };
}
