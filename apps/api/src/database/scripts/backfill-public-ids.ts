import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { eq, isNull } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { caregivers } from '../schema';

/**
 * Repair tool, not a required migration step. Migration 0004 backfills
 * `public_id` inline before enforcing NOT NULL, so a normal `npm run
 * db:migrate` leaves nothing to do here.
 *
 *   npx tsx src/database/scripts/backfill-public-ids.ts
 *
 * Only needed to repair a database where `public_id` ended up nullable with
 * NULL rows - e.g. rows inserted out-of-band after 0003 but before 0004 was
 * applied. Safe to re-run: only touches rows where public_id is still null.
 * On a fresh database (no pre-existing caregivers) this is a no-op - new rows
 * already get a public_id at creation time (see caregivers.service.ts /
 * auth.service.ts).
 */
async function main() {
  const connection = await mysql.createConnection(
    process.env.DATABASE_URL || 'mysql://care_app:care_app_password@localhost:3306/care_platform',
  );
  const db = drizzle(connection);

  const rows = await db.select({ id: caregivers.id }).from(caregivers).where(isNull(caregivers.publicId));

  console.log(`Backfilling public_id for ${rows.length} caregiver row(s)...`);
  for (const row of rows) {
    await db.update(caregivers).set({ publicId: uuid() }).where(eq(caregivers.id, row.id));
  }
  console.log('Done.');
  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
