import { readFileSync } from 'fs';
import { resolve } from 'path';
import { asc, eq, sql } from 'drizzle-orm';
import { cell, readCsvRecords, requireColumns } from '../csv';
import type { Database } from '../database.module';
import { cities, districts, provinces } from '../schema';

/**
 * Loads Sri Lanka's administrative divisions from the three CSVs in
 * seed-data/, replacing anything already in the tables.
 *
 * Resolved relative to this file's own directory (not CWD), so whatever copies
 * the compiled loader into a runtime image must also copy the seed-data folder
 * alongside it - the same constraint seed-reference-data.ts documents.
 */
const SEED_DATA_DIR = resolve(__dirname, '../seed-data');

export interface ProvinceRow {
  id: number;
  nameEn: string;
  nameSi: string;
  nameTa: string;
}

export interface DistrictRow {
  id: number;
  provinceId: number;
  nameEn: string;
  nameSi: string;
  nameTa: string;
}

export interface CityRow {
  id: number;
  districtId: number;
  nameEn: string;
  nameSi: string;
  nameTa: string;
  subNameEn: string | null;
  subNameSi: string | null;
  subNameTa: string | null;
  postcode: string | null;
  latitude: number;
  longitude: number;
}

function readSeedFile(name: string): string {
  const path = resolve(SEED_DATA_DIR, name);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Missing ${path}. The location reference data ships with the repository in apps/api/src/database/seed-data/.`);
  }
}

function positiveInt(value: string | null, where: string, column: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${where}: ${column} must be a positive integer, found "${value ?? ''}"`);
  }
  return parsed;
}

function required(value: string | null, where: string, column: string): string {
  if (!value) throw new Error(`${where}: ${column} is required, found an empty value`);
  return value;
}

/**
 * Parses and validates all three files, in full, before a single row is
 * written. A reference set that is half-loaded is worse than one that failed:
 * every district dropdown in the country would render an incomplete list and
 * nothing would say why.
 */
export function parseLocationCsvs(): { provinces: ProvinceRow[]; districts: DistrictRow[]; cities: CityRow[] } {
  // ---- provinces -----------------------------------------------------------
  const pFile = 'provinces.csv';
  const pRaw = readSeedFile(pFile);
  const pCsv = readCsvRecords(pRaw, pFile);
  requireColumns(pFile, pCsv.header, ['provincesid', 'nameen', 'namesi', 'nameta']);
  const provinceRows: ProvinceRow[] = pCsv.rows.map((row, i) => {
    const where = `${pFile} row ${i + 2}`;
    return {
      id: positiveInt(cell(row.provincesid), where, 'provinces_id'),
      nameEn: required(cell(row.nameen), where, 'name_en'),
      nameSi: required(cell(row.namesi), where, 'name_si'),
      nameTa: required(cell(row.nameta), where, 'name_ta'),
    };
  });
  const provinceIds = new Set(provinceRows.map((r) => r.id));
  if (provinceIds.size !== provinceRows.length) throw new Error(`${pFile}: duplicate provinces_id`);

  // ---- districts -----------------------------------------------------------
  const dFile = 'districts.csv';
  const dRaw = readSeedFile(dFile);
  const dCsv = readCsvRecords(dRaw, dFile);
  requireColumns(dFile, dCsv.header, ['districtid', 'provinceid', 'nameen', 'namesi', 'nameta']);
  const districtRows: DistrictRow[] = dCsv.rows.map((row, i) => {
    const where = `${dFile} row ${i + 2}`;
    const provinceId = positiveInt(cell(row.provinceid), where, 'province_id');
    if (!provinceIds.has(provinceId)) {
      throw new Error(`${where}: province_id ${provinceId} is not in ${pFile}`);
    }
    return {
      id: positiveInt(cell(row.districtid), where, 'district id'),
      provinceId,
      nameEn: required(cell(row.nameen), where, 'name_en'),
      nameSi: required(cell(row.namesi), where, 'name_si'),
      nameTa: required(cell(row.nameta), where, 'name_ta'),
    };
  });
  const districtIds = new Set(districtRows.map((r) => r.id));
  if (districtIds.size !== districtRows.length) throw new Error(`${dFile}: duplicate district id`);

  // ---- cities --------------------------------------------------------------
  const cFile = 'cities.csv';
  const cRaw = readSeedFile(cFile);
  const cCsv = readCsvRecords(cRaw, cFile);
  requireColumns(cFile, cCsv.header, [
    'cityid',
    'districtid',
    'nameen',
    'namesi',
    'nameta',
    'subnameen',
    'subnamesi',
    'subnameta',
    'postcode',
    'latitude',
    'longitude',
  ]);
  const cityRows: CityRow[] = cCsv.rows.map((row, i) => {
    const where = `${cFile} row ${i + 2}`;
    const districtId = positiveInt(cell(row.districtid), where, 'district_id');
    if (!districtIds.has(districtId)) {
      throw new Error(`${where}: district_id ${districtId} is not in ${dFile}`);
    }
    // Rejected rather than clamped: a coordinate outside the globe is a bad
    // row, and silently turning it into 0 would put a caregiver in the ocean.
    const latitude = Number(cell(row.latitude));
    const longitude = Number(cell(row.longitude));
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`${where}: latitude must be between -90 and 90, found "${row.latitude}"`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`${where}: longitude must be between -180 and 180, found "${row.longitude}"`);
    }
    return {
      id: positiveInt(cell(row.cityid), where, 'city id'),
      districtId,
      nameEn: required(cell(row.nameen), where, 'name_en'),
      nameSi: required(cell(row.namesi), where, 'name_si'),
      nameTa: required(cell(row.nameta), where, 'name_ta'),
      subNameEn: cell(row.subnameen),
      subNameSi: cell(row.subnamesi),
      subNameTa: cell(row.subnameta),
      // Kept as the string it was written as. 47 Sri Lankan postcodes begin
      // with a zero, and parsing this as a number would lose it.
      postcode: cell(row.postcode),
      latitude,
      longitude,
    };
  });
  const cityIds = new Set(cityRows.map((r) => r.id));
  if (cityIds.size !== cityRows.length) throw new Error(`${cFile}: duplicate city id`);

  return { provinces: provinceRows, districts: districtRows, cities: cityRows };
}

/**
 * Replaces the contents of provinces/districts/cities with the CSVs.
 *
 * Idempotent: rows are upserted on the id the CSV carries, so re-running this
 * after editing a name updates that row rather than adding a second one. Rows
 * the CSVs no longer mention are deleted explicitly, by anti-join against a
 * staging table - not by TRUNCATE, which would fail outright because
 * caregivers.city_id and preferred_locations.city_id reference into these.
 */
export async function loadLocationCsvs(db: Database): Promise<{ provinces: number; districts: number; cities: number }> {
  const { provinces: provinceRows, districts: districtRows, cities: cityRows } = parseLocationCsvs();

  // Leaves most of cities (or the row's district) with no district.
  const parentIds = districtRows.map((r) => r.id);
  await db.delete(cities).where(sql`${cities.districtId} NOT IN ${parentIds}`);
  await db.delete(districts).where(sql`${districts.id} NOT IN ${provinceRows.map((r) => r.id)}`);
  await db.delete(provinces).where(sql`${provinces.id} NOT IN ${provinceRows.map((r) => r.id)}`);

  // Batched: 2155 cities in one INSERT would exceed max_allowed_packet once
  // the Sinhala and Tamil names are included.
  for (let i = 0; i < provinceRows.length; i += 500) {
    await db
      .insert(provinces)
      .values(provinceRows.slice(i, i + 500))
      .onDuplicateKeyUpdate({ set: { nameEn: sql`values(${provinces.nameEn})`, nameSi: sql`values(${provinces.nameSi})`, nameTa: sql`values(${provinces.nameTa})` } });
  }

  const districtValues = districtRows.map(({ id, provinceId, nameEn, nameSi, nameTa }) => ({ id, provinceId, nameEn, nameSi, nameTa }));
  for (let i = 0; i < districtValues.length; i += 500) {
    await db
      .insert(districts)
      .values(districtValues.slice(i, i + 500))
      .onDuplicateKeyUpdate({ set: { provinceId: sql`values(${districts.provinceId})`, nameEn: sql`values(${districts.nameEn})`, nameSi: sql`values(${districts.nameSi})`, nameTa: sql`values(${districts.nameTa})` } });
  }

  const cityValues = cityRows.map(({ id, districtId, nameEn, nameSi, nameTa, subNameEn, subNameSi, subNameTa, postcode, latitude, longitude }) =>
    ({ id, districtId, nameEn, nameSi, nameTa, subNameEn, subNameSi, subNameTa, postcode, latitude, longitude }));
  for (let i = 0; i < cityValues.length; i += 500) {
    await db
      .insert(cities)
      .values(cityValues.slice(i, i + 500))
      .onDuplicateKeyUpdate({
        set: {
          districtId: sql`values(${cities.districtId})`,
          nameEn: sql`values(${cities.nameEn})`,
          nameSi: sql`values(${cities.nameSi})`,
          nameTa: sql`values(${cities.nameTa})`,
          subNameEn: sql`values(${cities.subNameEn})`,
          subNameSi: sql`values(${cities.subNameSi})`,
          subNameTa: sql`values(${cities.subNameTa})`,
          postcode: sql`values(${cities.postcode})`,
          latitude: sql`values(${cities.latitude})`,
          longitude: sql`values(${cities.longitude})`,
        },
      });
  }

  return { provinces: provinceRows.length, districts: districtRows.length, cities: cityRows.length };
}

/** Sorted id lists, for the seed fixtures that need to resolve a name. */
export async function locationIdsByName(db: Database) {
  const rows = await db
    .select({ id: cities.id, nameEn: cities.nameEn, districtName: districts.nameEn })
    .from(cities)
    .innerJoin(districts, eq(cities.districtId, districts.id))
    .orderBy(asc(cities.id));

  const byName = new Map<string, number[]>();
  for (const row of rows) {
    // A name can repeat across districts, so the map holds every id under it
    // rather than pretending one of them is "the" match.
    byName.set(row.nameEn, [...(byName.get(row.nameEn) ?? []), row.id]);
  }
  return byName;
}

// Runnable directly: `npm run db:load-locations`. Standalone rather than only
// reachable through the seeder so a data correction can be applied to a running
// environment without also re-running the dev fixtures.
if (require.main === module) {
  const { drizzle } = require('drizzle-orm/mysql2');
  const mysql = require('mysql2/promise');
  const { requireDatabaseUrl } = require('../load-env');
  const schema = require('../schema');
  void (async () => {
    const pool = mysql.createPool({ uri: requireDatabaseUrl() });
    const db = drizzle(pool, { schema, mode: 'default' });
    const counts = await loadLocationCsvs(db);
    console.log(`Loaded ${counts.provinces} provinces, ${counts.districts} districts, ${counts.cities} cities.`);
    await pool.end();
  })().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
