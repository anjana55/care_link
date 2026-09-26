import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { locations } from '../database/schema';

export interface CreateLocationInput {
  district: string;
  city: string;
  province: string;
}

@Injectable()
export class LocationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAll() {
    return this.db.select().from(locations);
  }

  async create(input: CreateLocationInput) {
    const [existing] = await this.db
      .select()
      .from(locations)
      .where(and(eq(locations.district, input.district), eq(locations.city, input.city)))
      .limit(1);
    if (existing) throw new ConflictException('Location already exists');
    const id = uuid();
    await this.db.insert(locations).values({ id, ...input });
    return { id, ...input };
  }
}
