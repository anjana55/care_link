import { requireDatabaseUrl } from '../load-env';
import mysql from 'mysql2/promise';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * Rewrites the three location CSVs in seed-data/ from a database that has the
 * full set loaded - the inverse of load-location-csv.ts, so a data correction
 * made in SQL can be pushed back into the files the loader reads.
 *
 *   npm run db:load-locations                       # loads the CSVs
 *   npx ts-node src/database/scripts/export-locations.ts   # rewrites the CSVs
 *
 * Emits LF line endings and leaves NULL cells empty. The loader accepts CRLF,
 * `NULL` and ` NULL` as well, because the files were supplied that way; there
 * is no reason to reproduce that when writing our own.
 *
 * Reads DATABASE_URL from the environment (see .env), so no credential ever
 * appears on a command line. Re-running is safe: the files are overwritten.
 */
const SEED_DATA_DIR = resolve(__dirname, '../seed-data');

/** Quote a field only when it would otherwise break CSV parsing. */
function csvField(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function write(name: string, header: string[], rows: (string | number | null)[][]): string {
  const path = resolve(SEED_DATA_DIR, name);
  mkdirSync(dirname(path), { recursive: true });
  const lines = [header.join(','), ...rows.map((row) => row.map(csvField).join(','))];
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

async function main() {
  const connection = await mysql.createConnection(requireDatabaseUrl());

  const [provinces] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT id, name_en, name_si, name_ta FROM provinces ORDER BY id',
  );
  const [districts] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT id, province_id, name_en, name_si, name_ta FROM districts ORDER BY id',
  );
  const [cities] = await connection.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.district_id, c.name_en, c.name_si, c.name_ta,
            c.sub_name_en, c.sub_name_si, c.sub_name_ta, c.postcode,
            CAST(c.latitude AS CHAR) AS latitude, CAST(c.longitude AS CHAR) AS longitude
       FROM cities c ORDER BY c.id`,
  );
  await connection.end();

  if (!provinces.length || !districts.length || !cities.length) {
    console.error('One or more of provinces/districts/cities is empty - refusing to write CSVs that would wipe the data.');
    process.exit(1);
  }

  const written = [
    write('provinces.csv', ['provinces_id', 'name_en', 'name_si', 'name_ta'], provinces.map((r) => [r.id, r.name_en, r.name_si, r.name_ta])),
    write('districts.csv', ['district id', 'province_id', 'name_en', 'name_si', 'name_ta'], districts.map((r) => [r.id, r.province_id, r.name_en, r.name_si, r.name_ta])),
    write(
      'cities.csv',
      ['city id', 'district_id', 'name_en', 'name_si', 'name_ta', 'sub_name_en', 'sub_name_si', 'sub_name_ta', 'postcode', 'latitude', 'longitude'],
      cities.map((r) => [r.id, r.district_id, r.name_en, r.name_si, r.name_ta, r.sub_name_en, r.sub_name_si, r.sub_name_ta, r.postcode, r.latitude, r.longitude]),
    ),
  ];
  written.forEach((path) => console.log(`Wrote ${path}`));
  console.log(`${provinces.length} provinces, ${districts.length} districts, ${cities.length} cities`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
