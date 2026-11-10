import '../load-env';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { asc, eq, sql } from 'drizzle-orm';
import { CAREGIVER_REF_LENGTH } from '@care-platform/shared';
import { caregivers } from '../schema';
import { generateUniquePublicId } from '../../caregivers/caregiver-ref.util';

/**
 * Finds caregivers whose short ID - the first CAREGIVER_REF_LENGTH
 * characters of `public_id`, what customers see as "Caregiver abcd1234" -
 * is shared with another caregiver, and optionally reissues it.
 *
 *   npm run db:check-public-refs -w @care-platform/api            # report only
 *   npm run db:check-public-refs -w @care-platform/api -- --apply # reissue
 *
 * New caregivers already get a unique short ID (generateUniquePublicId), so
 * this is a one-off for rows created before that. In each clash the oldest
 * caregiver keeps their ID; the others get a new `public_id`. That changes
 * their public profile link, so a customer holding the old link or ID will
 * no longer reach them - run it once, early, and staff can still find them
 * by name. Saved caregivers, requests and bookings use the internal id and
 * are unaffected. Safe to re-run: it does nothing once there are no clashes.
 */
async function main() {
  const apply = process.argv.includes('--apply');
  const connection = await mysql.createConnection(
    process.env.DATABASE_URL || 'mysql://care_app:care_app_password@localhost:3306/care_platform',
  );
  const db = drizzle(connection);

  const ref = sql<string>`LEFT(${caregivers.publicId}, ${CAREGIVER_REF_LENGTH})`;
  const clashes = await db
    .select({ ref, n: sql<number>`COUNT(*)` })
    .from(caregivers)
    .groupBy(ref)
    .having(sql`COUNT(*) > 1`);

  if (!clashes.length) {
    console.log('No shared caregiver IDs. Nothing to do.');
    await connection.end();
    return;
  }

  console.log(`${clashes.length} caregiver ID(s) are shared by more than one caregiver:`);
  for (const clash of clashes) {
    const rows = await db
      .select({ id: caregivers.id, publicId: caregivers.publicId, registrationNumber: caregivers.registrationNumber, createdAt: caregivers.createdAt })
      .from(caregivers)
      .where(sql`LEFT(${caregivers.publicId}, ${CAREGIVER_REF_LENGTH}) = ${clash.ref}`)
      .orderBy(asc(caregivers.createdAt), asc(caregivers.id));
    const [keep, ...reissue] = rows;
    console.log(`  ${clash.ref}: keeps ${keep.registrationNumber}; reissue ${reissue.map((r) => r.registrationNumber).join(', ')}`);
    if (!apply) continue;
    for (const row of reissue) {
      const publicId = await generateUniquePublicId(db);
      await db.update(caregivers).set({ publicId }).where(eq(caregivers.id, row.id));
      console.log(`    ${row.registrationNumber}: ${row.publicId.slice(0, CAREGIVER_REF_LENGTH)} -> ${publicId.slice(0, CAREGIVER_REF_LENGTH)}`);
    }
  }
  if (!apply) console.log('\nReport only. Re-run with --apply to reissue.');
  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
