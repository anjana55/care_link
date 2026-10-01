import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { preferredLocations, locations } from '../database/schema';

@Injectable()
export class PreferredLocationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db
      .select({
        locationId: preferredLocations.locationId,
        district: locations.district,
        city: locations.city,
        province: locations.province,
      })
      .from(preferredLocations)
      .innerJoin(locations, eq(preferredLocations.locationId, locations.id))
      .where(eq(preferredLocations.caregiverId, caregiverId));
  }

  async assign(caregiverId: string, locationId: string) {
    const [existing] = await this.db
      .select()
      .from(preferredLocations)
      .where(and(eq(preferredLocations.caregiverId, caregiverId), eq(preferredLocations.locationId, locationId)))
      .limit(1);
    if (existing) throw new ConflictException('This location is already a preferred location for the caregiver');

    await this.db.insert(preferredLocations).values({ caregiverId, locationId });
    return this.findAllForCaregiver(caregiverId);
  }

  async remove(caregiverId: string, locationId: string) {
    await this.db
      .delete(preferredLocations)
      .where(and(eq(preferredLocations.caregiverId, caregiverId), eq(preferredLocations.locationId, locationId)));
    return { success: true };
  }
}
