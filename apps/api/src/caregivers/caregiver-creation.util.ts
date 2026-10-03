import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { caregivers, cities, districts, provinces } from '../database/schema';
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

export interface ResolvedLocation {
  districtId: number | null;
  cityId: number | null;
  /** English display caches. The public site renders its own language from the
   * ids; these exist so staff lists, exports and admin filters never need a
   * join, and they are only ever written from here. */
  district: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}

/**
 * Turns a submitted districtId/cityId pair into the row values to store.
 *
 * The city has to belong to the district. The city dropdown is derived from
 * the district, so a mismatched pair is always either a client bug or a
 * hand-rolled request - and storing one produces a record the district-scoped
 * filters in public-search can never match. Reject it at the boundary.
 *
 * Returns null when neither id is supplied, so a partial update that doesn't
 * touch the location is a no-op rather than an erasure.
 *
 * Accepts a transaction handle as well as the top-level Database - see the
 * note on generateRegistrationNumber above.
 */
export async function resolveLocationRefs(
  db: Database,
  fields: { districtId?: number | null; cityId?: number | null },
): Promise<ResolvedLocation | null> {
  if (!fields.districtId && !fields.cityId) return null;

  const [city] = fields.cityId
    ? await db.select().from(cities).where(eq(cities.id, fields.cityId)).limit(1)
    : [];
  if (fields.cityId && !city) {
    throw new BadRequestException(`Unknown city id: ${fields.cityId}`);
  }
  if (city && fields.districtId && city.districtId !== fields.districtId) {
    throw new BadRequestException(
      `City ${city.id} belongs to district ${city.districtId}, not district ${fields.districtId}`,
    );
  }

  const districtId = fields.districtId ?? city?.districtId ?? null;
  const [district] = districtId
    ? await db.select().from(districts).where(eq(districts.id, districtId)).limit(1)
    : [];
  if (districtId && !district) {
    throw new BadRequestException(`Unknown district id: ${districtId}`);
  }

  const [province] = district
    ? await db.select({ nameEn: provinces.nameEn }).from(provinces).where(eq(provinces.id, district.provinceId)).limit(1)
    : [];

  return {
    districtId,
    cityId: city?.id ?? null,
    district: district?.nameEn ?? null,
    city: city?.nameEn ?? null,
    province: province?.nameEn ?? null,
    postalCode: city?.postcode ?? null,
  };
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
