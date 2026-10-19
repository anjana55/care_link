import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as schema from './schema';
import { UTC_CONNECTION_OPTIONS, useUtcSessions } from './utc-session';

export const DRIZZLE = 'DRIZZLE_CONNECTION';

export type Database = MySql2Database<typeof schema>;

const MYSQL_POOL = 'MYSQL_POOL';

/**
 * Closes the pool when the app shuts down (app.close(), or a signal once
 * enableShutdownHooks is on). Idle pool connections otherwise keep Node running:
 * the e2e suites finished but Jest never exited. It runs after every module's
 * onModuleDestroy, so anything that still queries on its way out has finished.
 */
@Injectable()
class DatabasePoolCloser implements OnApplicationShutdown {
  constructor(@Inject(MYSQL_POOL) private readonly pool: mysql.Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MYSQL_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = mysql.createPool({
          uri: config.get<string>('DATABASE_URL'),
          connectionLimit: 10,
          ...UTC_CONNECTION_OPTIONS,
        });
        useUtcSessions(pool);
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [MYSQL_POOL],
      useFactory: (pool: mysql.Pool) => drizzle(pool, { schema, mode: 'default' }),
    },
    DatabasePoolCloser,
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
