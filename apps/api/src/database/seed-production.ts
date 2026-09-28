import { requireDatabaseUrl } from './load-env';
import * as bcrypt from 'bcrypt';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq } from 'drizzle-orm';
import * as mysql from 'mysql2/promise';
import { randomUUID as uuid } from 'crypto';
import * as schema from './schema';
import { seedReferenceData } from './seed-reference-data';

/**
 * The seed step every fresh deployment actually needs - as opposed to
 * seed.ts, which also loads dev-only fixtures (demo caregivers, a
 * staff/verifier login, a hardcoded password) that have no place running
 * unattended against a real production database.
 *
 * Idempotent and safe to run on every deploy:
 *  - Reference data (skills/languages/locations) upserts by its natural
 *    key, same as seed.ts.
 *  - The initial admin is only ever created if no ADMIN account exists
 *    yet - it never touches an existing admin's password or details.
 *
 * Requires INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in the
 * environment when no admin exists yet; see setup.sh, which supplies
 * both for you.
 */
async function main() {
  const connection = await mysql.createConnection(requireDatabaseUrl());
  const db = drizzle(connection, { schema, mode: 'default' });

  await seedReferenceData(db);

  console.log('Checking for an existing admin account...');
  const [existingAdmin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.role, 'ADMIN')).limit(1);

  if (existingAdmin) {
    console.log('  An admin account already exists - leaving it untouched.');
  } else {
    const email = process.env.INITIAL_ADMIN_EMAIL;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    const fullName = process.env.INITIAL_ADMIN_NAME || 'Platform Administrator';

    if (!email || !password) {
      throw new Error(
        'No admin account exists yet, and INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD ' +
          'were not provided - set both (INITIAL_ADMIN_NAME is optional) and run this again.',
      );
    }
    if (password.length < 8) {
      throw new Error('INITIAL_ADMIN_PASSWORD must be at least 8 characters.');
    }

    // Belt-and-suspenders: the role check above is the real "does an admin
    // exist" test, but if this email happens to already be taken by a
    // non-admin account, fail loudly rather than silently doing nothing.
    const [existingByEmail] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existingByEmail) {
      throw new Error(`A user with email ${email} already exists but is not an admin - resolve this manually.`);
    }

    console.log(`Creating initial admin account (${email})...`);
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert(schema.users).values({
      id: uuid(),
      email,
      passwordHash,
      fullName,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    });
    console.log('  Admin account created.');
  }

  console.log('Production seed complete.');
  await connection.end();
}

main().catch((err) => {
  console.error('Production seed failed:', err);
  process.exit(1);
});
