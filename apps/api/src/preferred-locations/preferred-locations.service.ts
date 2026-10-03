import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { resolveLocale, type Locale } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { cities, districts, preferredLocations, provinces } from '../database/schema';

@Injectable()
export class PreferredLocationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * A caregiver's preferred work locations, named in `locale`.
   *
   * The city name comes from the row itself rather than from the caregiver's
   * own district/city pair: someone can live in Dehiwala and prefer to work in
   * Kandy, and the preferred list is the one that has to say so.
   */
  findAllForCaregiver(caregiverId: string, locale: Locale = 'en') {
    return this.db
      .select({
        cityId: preferredLocations.cityId,
        city: this.nameColumn(locale),
        district: districts.nameEn,
        province: provinces.nameEn,
      })
      .from(preferredLocations)
      .innerJoin(cities, eq(preferredLocations.cityId, cities.id))
      .innerJoin(districts, eq(cities.districtId, districts.id))
      .innerJoin(provinces, eq(districts.provinceId, provinces.id))
      .where(eq(preferredLocations.caregiverId, caregiverId));
  }

  async assign(caregiverId: string, cityId: number) {
    const [city] = await this.db.select({ id: cities.id }).from(cities).where(eq(cities.id, cityId)).limit(1);
    if (!city) throw new ConflictException(`Unknown city id: ${cityId}`);

    const [existing] = await this.db
      .select()
      .from(preferredLocations)
      .where(and(eq(preferredLocations.caregiverId, caregiverId), eq(preferredLocations.cityId, cityId)))
      .limit(1);
    if (existing) throw new ConflictException('This location is already a preferred location for the caregiver');

    await this.db.insert(preferredLocations).values({ caregiverId, cityId });
    return this.findAllForCaregiver(caregiverId);
  }

  async remove(caregiverId: string, cityId: number) {
    await this.db
      .delete(preferredLocations)
      .where(and(eq(preferredLocations.caregiverId, caregiverId), eq(preferredLocations.cityId, cityId)));
    return { success: true };
  }

  /** Drizzle cannot pick a column from a runtime value, so resolveLocale is
   * applied here: only the three real columns are ever handed to the query
   * builder, and the switch is over our own literals. */
  private nameColumn(locale: Locale) {
    return resolveLocale(locale) === 'si' ? cities.nameSi : resolveLocale(locale) === 'ta' ? cities.nameTa : cities.nameEn;
  }
}