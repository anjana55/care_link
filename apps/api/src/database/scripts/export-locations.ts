import { requireDatabaseUrl } from '../load-env';
import mysql from 'mysql2/promise';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * Regenerates seed-data/locations.csv from a database that has the full
 * location list loaded. That CSV is the source of truth for the locations
 * written by `npm run db:seed` - this script only exists to refresh it.
 *
 *   npm run db:seed -w @care-platform/api        # consumes the CSV
 *   npx ts-node src/database/scripts/export-locations.ts   # rewrites the CSV
 *
 * Reads DATABASE_URL from the environment (see .env), so no credential ever
 * appears on a command line. Re-running is safe: the file is overwritten.
 */
const OUTPUT = resolve(__dirname, '../seed-data/locations.csv');

/** Quote a field only when it would otherwise break CSV parsing. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main() {
  const connection = await mysql.createConnection(requireDatabaseUrl());

  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT district, city, province FROM locations ORDER BY province, district, city',
  );
  await connection.end();

  if (rows.length === 0) {
    console.error('No rows in locations - refusing to write an empty CSV.');
    process.exit(1);
  }

  const lines = ['district,city,province'];
  for (const row of rows) {
    lines.push([row.district, row.city, row.province].map(csvField).join(','));
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${rows.length} locations to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
