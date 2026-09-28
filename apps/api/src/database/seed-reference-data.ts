import { sql } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as schema from './schema';
import type { Database } from './database.module';

/**
 * Location reference data lives in seed-data/locations.csv rather than inline,
 * because there are ~1800 of them. Regenerate that file from a database that
 * already has the full list loaded:
 *
 *   npx ts-node src/database/scripts/export-locations.ts
 *
 * Resolved relative to this compiled file's own directory (not CWD), so
 * whatever copies dist/src/database/seed.js or seed-production.js into a
 * runtime image must also copy this seed-data folder alongside it.
 */
const LOCATIONS_CSV = resolve(__dirname, 'seed-data/locations.csv');

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char !== '"') {
        current += char;
      } else if (line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function loadLocationRows(): { district: string; city: string; province: string }[] {
  let raw: string;
  try {
    raw = readFileSync(LOCATIONS_CSV, 'utf8');
  } catch {
    throw new Error(`Missing ${LOCATIONS_CSV}.\nGenerate it with: npx ts-node src/database/scripts/export-locations.ts`);
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = parseCsvLine(lines.shift() ?? '').map((h) => h.trim().toLowerCase());
  if (header.join(',') !== 'district,city,province') {
    throw new Error(`Unexpected CSV header in ${LOCATIONS_CSV}: "${header.join(',')}"`);
  }

  return lines.map((line, index) => {
    const [district, city, province] = parseCsvLine(line);
    if (!district || !city || !province) {
      throw new Error(`Malformed row ${index + 2} in ${LOCATIONS_CSV}: "${line}"`);
    }
    return { district, city, province };
  });
}

/**
 * Seeds the reference data every environment needs to function at all -
 * skills, languages, and the ~1800 Sri Lankan locations - none of it PII,
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

  console.log('Seeding Sri Lankan locations from seed-data/locations.csv...');
  const locationValues = loadLocationRows().map((row) => ({ id: uuid(), ...row }));

  // Batched, so ~1800 rows don't become ~1800 sequential round trips.
  for (let i = 0; i < locationValues.length; i += 500) {
    await db
      .insert(schema.locations)
      .values(locationValues.slice(i, i + 500))
      .onDuplicateKeyUpdate({ set: { province: sql`values(${schema.locations.province})` } });
  }

  // Read the ids back rather than trusting the generated ones: on a re-seed the
  // unique (district, city) key matches the existing row, so the row keeps its
  // original id and the freshly generated one is never written.
  const persistedLocations = await db
    .select({
      id: schema.locations.id,
      district: schema.locations.district,
      city: schema.locations.city,
    })
    .from(schema.locations);
  const locationIds: Record<string, string> = {};
  for (const row of persistedLocations) {
    locationIds[`${row.district}-${row.city}`] = row.id;
  }
  console.log(`  ${persistedLocations.length} locations available.`);

  return { skillIds, languageIds, locationIds };
}
