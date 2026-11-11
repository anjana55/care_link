import { mysqlTable, varchar, datetime, mysqlEnum, int, json, index, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const jobStatusEnum = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof jobStatusEnum)[number];

/**
 * Durable background work: "send this offer", "check this shift in 15
 * minutes", "draft this payout". A row survives a restart and is retried, so
 * an agent's follow-up step is never lost the way an in-memory timer would
 * lose it - and it lives in MySQL, so there is no new server software to run.
 *
 * `unique_key` makes scheduling idempotent: the same key can only ever be
 * queued once ("offer-expiry:<offerId>"), however many times a step runs.
 * `payload` holds ids and references only - never names, contact details or
 * health data, since job rows are kept for a month.
 */
export const jobs = mysqlTable(
  'jobs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    uniqueKey: varchar('unique_key', { length: 191 }),
    status: mysqlEnum('status', jobStatusEnum).notNull().default('PENDING'),
    runAt: datetime('run_at', { fsp: 3 }).notNull(),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(5),
    lockedAt: datetime('locked_at', { fsp: 3 }),
    lockedBy: varchar('locked_by', { length: 64 }),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    finishedAt: datetime('finished_at', { fsp: 3 }),
  },
  (t) => ({
    dueIdx: index('jobs_due_idx').on(t.status, t.runAt),
    uniqueKeyIdx: uniqueIndex('jobs_unique_key').on(t.uniqueKey),
    typeIdx: index('jobs_type_idx').on(t.type, t.status),
  }),
);
