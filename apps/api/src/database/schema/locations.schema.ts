import { mysqlTable, varchar, datetime, index, primaryKey, unique } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const locations = mysqlTable(
  'locations',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    district: varchar('district', { length: 100 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    province: varchar('province', { length: 100 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    districtCityUnique: unique('locations_district_city_unique').on(table.district, table.city),
  }),
);

export const preferredLocations = mysqlTable(
  'preferred_locations',
  {
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    locationId: varchar('location_id', { length: 36 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.caregiverId, table.locationId] }),
    locationIdx: index('preferred_locations_location_idx').on(table.locationId),
  }),
);
