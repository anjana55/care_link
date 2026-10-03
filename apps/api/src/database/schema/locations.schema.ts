import { sql } from 'drizzle-orm';
import { datetime, decimal, index, int, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

/**
 * Sri Lanka's administrative divisions, loaded from seed-data/provinces.csv,
 * districts.csv and cities.csv. Each row carries its name in all three
 * languages the platform ships, so a dropdown can label itself in whichever
 * one the visitor picked without a second round trip.
 *
 * The primary key is the id the CSV carries, not a generated one. The CSVs are
 * the authority on this data, and using their ids makes the loader idempotent
 * (re-running it updates rows rather than duplicating them) and makes the
 * caregiver table's district_id/city_id columns stable across reloads.
 */
export const provinces = mysqlTable('provinces', {
  id: int('id').primaryKey(),
  nameEn: varchar('name_en', { length: 100 }).notNull(),
  nameSi: varchar('name_si', { length: 100 }).notNull(),
  nameTa: varchar('name_ta', { length: 100 }).notNull(),
});

export const districts = mysqlTable(
  'districts',
  {
    id: int('id').primaryKey(),
    provinceId: int('province_id')
      .notNull()
      .references(() => provinces.id),
    nameEn: varchar('name_en', { length: 100 }).notNull(),
    nameSi: varchar('name_si', { length: 100 }).notNull(),
    nameTa: varchar('name_ta', { length: 100 }).notNull(),
  },
  (table) => ({
    provinceIdx: index('districts_province_idx').on(table.provinceId),
  }),
);

export const cities = mysqlTable(
  'cities',
  {
    id: int('id').primaryKey(),
    districtId: int('district_id')
      .notNull()
      .references(() => districts.id),
    nameEn: varchar('name_en', { length: 100 }).notNull(),
    nameSi: varchar('name_si', { length: 100 }).notNull(),
    nameTa: varchar('name_ta', { length: 100 }).notNull(),
    // The handful of cities the source data qualifies with a second name
    // ("Modara"). Null for all three in almost every row, and null in a
    // different subset per language - hence no notNull() on any of them.
    subNameEn: varchar('sub_name_en', { length: 100 }),
    subNameSi: varchar('sub_name_si', { length: 100 }),
    subNameTa: varchar('sub_name_ta', { length: 100 }),
    // varchar, not int: 47 Sri Lankan postcodes begin with a zero and would
    // lose it. 101 rows have no postcode at all.
    postcode: varchar('postcode', { length: 10 }),
    latitude: decimal('latitude', { precision: 10, scale: 8, mode: 'number' }).notNull(),
    longitude: decimal('longitude', { precision: 11, scale: 8, mode: 'number' }).notNull(),
  },
  (table) => ({
    // Every city dropdown reads one district's worth at a time, and the
    // caregiver rows join on district_id.
    districtIdx: index('cities_district_idx').on(table.districtId),
    // Only the staff browse-and-filter page does free-text lookup on this.
    nameIdx: index('cities_name_en_idx').on(table.nameEn),
  }),
);

/**
 * Which cities a caregiver will travel to, as distinct from the city they live
 * in. Re-pointed at `cities` when the reference data was replaced: every row
 * here previously held a uuid into the old `locations` table, and the names in
 * the new CSV are ambiguous (ten of them are reused across districts), so
 * there is no honest way to translate the old ids. The table was dropped and
 * recreated empty.
 */
export const preferredLocations = mysqlTable(
  'preferred_locations',
  {
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    cityId: int('city_id')
      .notNull()
      .references(() => cities.id),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.caregiverId, table.cityId] }),
    cityIdx: index('preferred_locations_city_idx').on(table.cityId),
  }),
);
