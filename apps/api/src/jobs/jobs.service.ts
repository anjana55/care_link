import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { hostname } from 'os';
import type { JobsSummary } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { jobs } from '../database/schema';

export type JobHandler = (payload: Record<string, unknown>, job: { id: string; attempt: number }) => Promise<void>;

export interface EnqueueOptions {
  /** When to run. Left out: as soon as possible. */
  runAt?: Date;
  /** The same key is only ever queued once, however often this is called. */
  uniqueKey?: string;
  /** Attempts before the job is given up as FAILED. Default 5. */
  maxAttempts?: number;
}

const TICK_MS = 5_000;
const BATCH = 10;
/** A job still RUNNING after this long belonged to a process that died. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;
const KEEP_DONE_DAYS = 30;
/** Wait before attempt 2, 3, 4...: 1 min, 5 min, 15 min, then hourly. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1];
}

/**
 * A small, durable job queue in MySQL.
 *
 * Modules register a handler per job type when they start; anything can
 * `enqueue()`. Every API instance polls every few seconds and claims due
 * jobs with SELECT ... FOR UPDATE SKIP LOCKED, so two instances never run
 * the same job. A handler that throws is retried with a growing wait and
 * finally marked FAILED, which shows on Settings > Automation.
 *
 * Handlers must be safe to run twice: a process can die after doing the
 * work but before recording it, and the job will then be run again.
 *
 * JOBS_ENABLED=false stops this instance from running jobs (they stay queued).
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly worker = `${hostname()}:${process.pid}`;
  private timers: NodeJS.Timeout[] = [];
  private busy = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  register(type: string, handler: JobHandler) {
    if (this.handlers.has(type)) throw new Error(`A handler for job type "${type}" is already registered`);
    this.handlers.set(type, handler);
  }

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('JOBS_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((e) => this.logger.error(`Job tick failed: ${(e as Error).message}`));
    const every = setInterval(tick, TICK_MS);
    const housekeeping = setInterval(() => void this.housekeeping().catch(() => undefined), 60 * 60 * 1000);
    every.unref();
    housekeeping.unref();
    this.timers = [every, housekeeping];
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  /** Queues a job. Returns its id, or null when `uniqueKey` was already queued. */
  async enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<string | null> {
    const id = uuid();
    try {
      await this.db.insert(jobs).values({
        id,
        type,
        payload,
        uniqueKey: opts.uniqueKey ?? null,
        runAt: opts.runAt ?? new Date(),
        maxAttempts: opts.maxAttempts ?? 5,
        createdAt: new Date(),
      });
      return id;
    } catch (err) {
      if (opts.uniqueKey && isDuplicate(err)) return null;
      throw err;
    }
  }

  /** Takes a queued job back out before it runs (an offer was answered, so its expiry check is not needed). */
  async cancel(uniqueKey: string): Promise<boolean> {
    const [result] = await this.db.delete(jobs).where(and(eq(jobs.uniqueKey, uniqueKey), eq(jobs.status, 'PENDING')));
    return (result as { affectedRows: number }).affectedRows > 0;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.releaseStuck();
      // Keep going while there is a full batch, so a backlog drains without waiting for the next tick.
      while ((await this.runDue()) === BATCH) {
        /* next batch */
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Claims up to one batch of due jobs and runs them. Returns how many it
   * ran. Public so tests (and a manual drain) can run the queue without the timer.
   */
  async runDue(now = new Date()): Promise<number> {
    const claimed = await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'PENDING'), lte(jobs.runAt, now), inArray(jobs.type, [...this.handlers.keys(), ''])))
        .orderBy(asc(jobs.runAt))
        .limit(BATCH)
        .for('update', { skipLocked: true });
      if (!due.length) return [];
      await tx
        .update(jobs)
        .set({ status: 'RUNNING', lockedAt: new Date(), lockedBy: this.worker, attempts: sql`${jobs.attempts} + 1` })
        .where(inArray(jobs.id, due.map((j) => j.id)));
      return due.map((j) => ({ ...j, attempts: j.attempts + 1 }));
    });

    for (const job of claimed) {
      try {
        await this.handlers.get(job.type)!(job.payload, { id: job.id, attempt: job.attempts });
        await this.db.update(jobs).set({ status: 'DONE', finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null }).where(eq(jobs.id, job.id));
      } catch (err) {
        const message = ((err as Error)?.message ?? String(err)).slice(0, 500);
        const giveUp = job.attempts >= job.maxAttempts;
        await this.db
          .update(jobs)
          .set(
            giveUp
              ? { status: 'FAILED', finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: message }
              : { status: 'PENDING', runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null, lastError: message },
          )
          .where(eq(jobs.id, job.id));
        this.logger[giveUp ? 'error' : 'warn'](`Job ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`);
      }
    }
    return claimed.length;
  }

  /** Jobs whose process died mid-run go back in the queue. Their attempt still counts. */
  async releaseStuck(now = new Date()): Promise<number> {
    const [result] = await this.db
      .update(jobs)
      .set({ status: 'PENDING', lockedAt: null, lockedBy: null, lastError: 'The server stopped while this was running' })
      .where(and(eq(jobs.status, 'RUNNING'), lt(jobs.lockedAt, new Date(now.getTime() - STUCK_AFTER_MS))));
    return (result as { affectedRows: number }).affectedRows;
  }

  /** Finished jobs are kept a month for looking into problems, then deleted. Failed ones stay until retried or cleared. */
  async housekeeping(now = new Date()): Promise<void> {
    await this.db.delete(jobs).where(and(eq(jobs.status, 'DONE'), lt(jobs.finishedAt, new Date(now.getTime() - KEEP_DONE_DAYS * 86_400_000))));
  }

  /** Puts a FAILED job back in the queue with a fresh set of attempts. */
  async retry(id: string): Promise<boolean> {
    const [result] = await this.db
      .update(jobs)
      .set({ status: 'PENDING', attempts: 0, runAt: new Date(), finishedAt: null, lastError: null })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'FAILED')));
    return (result as { affectedRows: number }).affectedRows > 0;
  }

  async summary(now = new Date()): Promise<JobsSummary> {
    const [counts, [oldest], failures] = await Promise.all([
      this.db.select({ status: jobs.status, n: sql<number>`COUNT(*)` }).from(jobs).where(inArray(jobs.status, ['PENDING', 'RUNNING', 'FAILED'])).groupBy(jobs.status),
      this.db.select({ runAt: jobs.runAt }).from(jobs).where(and(eq(jobs.status, 'PENDING'), lte(jobs.runAt, now))).orderBy(asc(jobs.runAt)).limit(1),
      this.db
        .select({ id: jobs.id, type: jobs.type, lastError: jobs.lastError, finishedAt: jobs.finishedAt })
        .from(jobs)
        .where(eq(jobs.status, 'FAILED'))
        .orderBy(desc(jobs.finishedAt))
        .limit(5),
    ]);
    const count = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
    return {
      pending: count('PENDING'),
      running: count('RUNNING'),
      failed: count('FAILED'),
      oldestDueMinutes: oldest ? Math.floor((now.getTime() - oldest.runAt.getTime()) / 60_000) : null,
      recentFailures: failures.map((f) => ({ ...f, finishedAt: f.finishedAt?.toISOString() ?? null })),
    };
  }
}

function isDuplicate(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === 'ER_DUP_ENTRY' || e?.cause?.code === 'ER_DUP_ENTRY';
}
