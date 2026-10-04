import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module';
import { cities, districts, provinces } from '../../database/schema';

/**
 * Turns a submitted districtId/cityId pair into the row values to store.
 *
 * Lives in common/ rather than with the caregivers because it is not about
 * caregivers: the body touches only the locations reference tables, and both
 * the auth services and the patients service already reach for it across
 * feature boundaries. Duplicating it would mean two copies of a validation
 * that must agree.
 *
 * The city has to belong to the district. The city dropdown is derived from
 * the district, so a mismatched pair is always either a client bug or a
 * hand-rolled request - and storing one produces a record the district-scoped
 * filters in public-search can never match. Reject it at the boundary.
 *
 * Returns null when neither id is supplied, so a partial update that doesn't
 * touch the location is a no-op rather than an erasure.
 *
 * Accepts a transaction handle as well as the top-level Database - both expose
 * the same query-builder surface for these read-only operations.
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