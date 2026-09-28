import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Shared env loading for the standalone database scripts (migrate, seed,
 * export-locations, ...), which run outside Nest and so don't get
 * ConfigModule's .env handling.
 *
 * `npm run db:*` runs with CWD = apps/api, but the .env may live there
 * (README: `cp .env.example .env`) or at the repo root. Both are checked;
 * variables already set in the real environment always win, then
 * apps/api/.env, then the repo-root .env.
 */
const ENV_CANDIDATES = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];

for (const path of ENV_CANDIDATES) {
  if (existsSync(path)) config({ path });
}

/**
 * Fails with an actionable message instead of letting mysql2 crash with
 * "Cannot read properties of undefined (reading 'isServer')" when handed
 * an undefined connection string.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
        '  - Create apps/api/.env (cp apps/api/.env.example apps/api/.env) and set DATABASE_URL, or\n' +
        '  - export DATABASE_URL="mysql://user:password@host:3306/dbname" in your shell.\n' +
        `  Looked for .env in: ${ENV_CANDIDATES.join(', ')}`,
    );
  }
  return url;
}
