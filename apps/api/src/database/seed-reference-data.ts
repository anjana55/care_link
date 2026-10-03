import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import * as schema from './schema';
import type { Database } from './database.module';
import { loadLocationCsvs } from './scripts/load-location-csv';

/**
 * Seeds the reference data every environment needs to function at all -
 * skills, languages, and the ~2200 Sri Lankan divisions - none of it PII,
 * none of it environment-specific. Idempotent: safe to run on every
 * deploy, every migration run, or repeatedly in dev.
 *
 * Used by both seed.ts (full dev fixtures) and seed-production.ts (the
 * lean, deploy-safe seed) so the two can never drift on how this part works.
 */
export async function seedReferenceData(db: Database) {
  console.log('Seeding skills...');
  const skillNames = [
    ['Insulin Administration', 'Medical'],
    ["Parkinson's Care", 'Specialized Care'],
    ['Patient Meal Preparation', 'Daily Living'],
    ['Vital Signs Monitoring', 'Medical'],
    ['Blood Pressure Monitoring', 'Medical'],
    ['Blood Sugar Monitoring', 'Medical'],
    ['Catheter Care', 'Medical'],
    ['Tube Feeding', 'Medical'],
    ['Adult Diaper Changing', 'Daily Living'],
    ['Wound Care / Dressing', 'Medical'],
    ['Dementia Care', 'Specialized Care'],
    ['Physiotherapy Assistance', 'Specialized Care'],
    ['Medication Assistance', 'Daily Living'],
    ['Bathing Assistance', 'Daily Living'],
  ] as const;
  const skillIds: Record<string, string> = {};
  for (const [name, category] of skillNames) {
    const id = uuid();
    skillIds[name] = id;
    await db.insert(schema.skills).values({ id, name, category }).onDuplicateKeyUpdate({ set: { category } });
  }

  console.log('Seeding languages...');
  const languageDefs = [
    ['Sinhala', 'si'],
    ['Tamil', 'ta'],
    ['English', 'en'],
  ] as const;
  const languageIds: Record<string, string> = {};
  for (const [name, code] of languageDefs) {
    const id = uuid();
    languageIds[name] = id;
    await db.insert(schema.languages).values({ id, name, code }).onDuplicateKeyUpdate({ set: { code } });
  }

  console.log('Loading Sri Lankan divisions from seed-data/{provinces,districts,cities}.csv...');
  const counts = await loadLocationCsvs(db);

  // Read the ids back rather than trusting the loader's: they are what the
  // caregiver fixtures below need, and reading them from the same query the
  // dropdowns use proves the data actually landed.
  const persisted = await db
    .select({
      id: schema.cities.id,
      districtId: schema.cities.districtId,
      cityName: schema.cities.nameEn,
      districtName: schema.districts.nameEn,
    })
    .from(schema.cities)
    .innerJoin(schema.districts, eq(schema.cities.districtId, schema.districts.id));
  // Keyed "District-City" because that is how the fixtures refer to places.
  // The value carries the district too, because a caregiver row needs both
  // ids and a fixture only names one of them.
  const locationIds: Record<string, { cityId: number; districtId: number }> = {};
  for (const row of persisted) {
    locationIds[`${row.districtName}-${row.cityName}`] = { cityId: row.id, districtId: row.districtId };
  }
  console.log(`  ${counts.provinces} provinces, ${counts.districts} districts, ${counts.cities} cities available.`);

  return { skillIds, languageIds, locationIds };
}
