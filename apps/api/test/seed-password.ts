/**
 * The password the demo accounts were seeded with.
 *
 * `db:seed` generates a random password unless SEED_PASSWORD is set, and
 * prints it once. An e2e run is a separate process from that seed, so it
 * cannot read what was printed - it has to be told the same value. Exporting
 * it from one place means the suites cannot drift apart from each other, or
 * from the seed, by editing a literal in one file and forgetting the rest.
 *
 * To run e2e against a freshly seeded database:
 *   SEED_PASSWORD=<password> npm run db:seed
 *   SEED_PASSWORD=<password> npm run test:e2e
 *
 * Falls back to a fixed dev-only value so a developer who seeded without the
 * variable can still run the suite; it authenticates nothing that is not
 * already local demo data.
 */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'local-e2e-password';