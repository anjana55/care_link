import * as mysql from 'mysql2/promise';

/**
 * Every DATETIME column holds UTC, whatever time zone the API host or the MySQL
 * server runs in.
 *
 * Two writers touch those columns: mysql2, when the API passes a JS Date, and
 * MySQL itself, for CURRENT_TIMESTAMP defaults and NOW(). By default mysql2 uses
 * the Node process's zone and MySQL uses its server's zone, so a host in
 * Asia/Colombo would store some values 5h30 ahead of others. That breaks
 * comparisons such as "created in the last hour" (OTP rate limits) and "has this
 * expired". Pinning both to UTC keeps them in step. Production (the MySQL 8
 * image, Node in Docker) already runs in UTC, so stored data is unaffected.
 */
export const UTC_CONNECTION_OPTIONS = { timezone: 'Z' } as const;

export function useUtcSessions(pool: mysql.Pool) {
  pool.pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
}

/** The same for a single connection (migrations and seed scripts). */
export async function connectUtc(uri: string) {
  const connection = await mysql.createConnection({ uri, ...UTC_CONNECTION_OPTIONS });
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}
