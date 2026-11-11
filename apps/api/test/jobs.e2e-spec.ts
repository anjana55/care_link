import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { eq, like } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { jobs } from '../src/database/schema';
import { JobsService, STUCK_AFTER_MS, backoffMs } from '../src/jobs/jobs.service';

/**
 * The durable job queue against real MySQL: jobs run once, in order, survive
 * failure with retries, are not run twice by two workers, and a dead worker's
 * jobs come back.
 */
describe('Job queue (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let queue: JobsService;
  const ran: { type: string; payload: Record<string, unknown>; attempt: number }[] = [];
  let failTimes = 0;
  const T = `test-${Date.now()}`;
  const row = async (id: string) => (await db.select().from(jobs).where(eq(jobs.id, id)))[0];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get<Database>(DRIZZLE);
    queue = app.get(JobsService);
    queue.register(`${T}.ok`, async (payload, job) => void ran.push({ type: 'ok', payload, attempt: job.attempt }));
    queue.register(`${T}.flaky`, async (payload, job) => {
      ran.push({ type: 'flaky', payload, attempt: job.attempt });
      if (failTimes-- > 0) throw new Error('The payment gateway timed out');
    });
    queue.register(`${T}.slow`, async (payload, job) => {
      await new Promise((r) => setTimeout(r, 150));
      ran.push({ type: 'slow', payload, attempt: job.attempt });
    });
  });

  beforeEach(async () => {
    ran.length = 0;
    failTimes = 0;
    await db.delete(jobs).where(like(jobs.type, `${T}.%`));
  });

  afterAll(async () => {
    await db.delete(jobs).where(like(jobs.type, `${T}.%`));
    await app.close();
  });

  it('runs a due job once and leaves a later one queued', async () => {
    const now = await queue.enqueue(`${T}.ok`, { invoiceId: 'a' });
    const later = await queue.enqueue(`${T}.ok`, { invoiceId: 'b' }, { runAt: new Date(Date.now() + 60_000) });

    expect(await queue.runDue()).toBe(1);
    expect(await queue.runDue()).toBe(0);
    expect(ran).toEqual([{ type: 'ok', payload: { invoiceId: 'a' }, attempt: 1 }]);
    expect(await row(now!)).toMatchObject({ status: 'DONE', attempts: 1, lockedBy: null });
    expect(await row(later!)).toMatchObject({ status: 'PENDING', attempts: 0 });

    // When its time comes, it runs.
    expect(await queue.runDue(new Date(Date.now() + 61_000))).toBe(1);
    expect((await row(later!)).status).toBe('DONE');
  });

  it('queues the same unique key only once, and can cancel it', async () => {
    const first = await queue.enqueue(`${T}.ok`, { offerId: 'x' }, { uniqueKey: `${T}:offer-expiry:x`, runAt: new Date(Date.now() + 60_000) });
    const again = await queue.enqueue(`${T}.ok`, { offerId: 'x' }, { uniqueKey: `${T}:offer-expiry:x` });
    expect(first).toBeTruthy();
    expect(again).toBeNull();

    expect(await queue.cancel(`${T}:offer-expiry:x`)).toBe(true);
    expect(await queue.cancel(`${T}:offer-expiry:x`)).toBe(false);
    expect(await queue.runDue(new Date(Date.now() + 120_000))).toBe(0);
  });

  it('retries a failing job with a growing wait, then gives up and can be retried by an admin', async () => {
    failTimes = 99;
    const id = (await queue.enqueue(`${T}.flaky`, { payoutId: 'p' }, { maxAttempts: 3 }))!;

    expect(await queue.runDue()).toBe(1);
    let job = await row(id);
    expect(job).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'The payment gateway timed out' });
    // Not due again until the first wait (1 minute) has passed.
    expect(await queue.runDue()).toBe(0);
    expect(job.runAt.getTime() - Date.now()).toBeGreaterThan(backoffMs(1) - 5_000);

    expect(await queue.runDue(new Date(Date.now() + backoffMs(1) + 1_000))).toBe(1);
    job = await row(id);
    expect(job).toMatchObject({ status: 'PENDING', attempts: 2 });
    expect(job.runAt.getTime() - Date.now()).toBeGreaterThan(backoffMs(2) - 5_000);

    expect(await queue.runDue(new Date(Date.now() + backoffMs(2) + 1_000))).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(ran.map((r) => r.attempt)).toEqual([1, 2, 3]);

    const summary = await queue.summary();
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(summary.recentFailures.some((f) => f.id === id && f.lastError === 'The payment gateway timed out')).toBe(true);

    failTimes = 0;
    expect(await queue.retry(id)).toBe(true);
    expect(await queue.retry(id)).toBe(false);
    expect(await queue.runDue()).toBe(1);
    expect(await row(id)).toMatchObject({ status: 'DONE', attempts: 1, lastError: null });
  });

  it('never runs a job twice when two workers poll at the same moment', async () => {
    for (let i = 0; i < 6; i++) await queue.enqueue(`${T}.slow`, { n: i });
    const counts = await Promise.all([queue.runDue(), queue.runDue(), queue.runDue()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(ran.map((r) => r.payload.n).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('puts back a job whose worker died, and leaves a job that is still running alone', async () => {
    const dead = (await queue.enqueue(`${T}.ok`, { shiftId: 's' }))!;
    const live = (await queue.enqueue(`${T}.ok`, { shiftId: 't' }))!;
    await db.update(jobs).set({ status: 'RUNNING', attempts: 1, lockedBy: 'gone:1', lockedAt: new Date(Date.now() - STUCK_AFTER_MS - 60_000) }).where(eq(jobs.id, dead));
    await db.update(jobs).set({ status: 'RUNNING', attempts: 1, lockedBy: 'busy:2', lockedAt: new Date() }).where(eq(jobs.id, live));

    expect(await queue.runDue()).toBe(0);
    expect(await queue.releaseStuck()).toBe(1);
    expect(await queue.runDue()).toBe(1);
    expect(await row(dead)).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(await row(live)).toMatchObject({ status: 'RUNNING', lockedBy: 'busy:2' });
  });

  it('leaves a job type nobody handles in the queue', async () => {
    const [before] = [await queue.summary()];
    await db.insert(jobs).values({ id: '00000000-0000-4000-8000-00000000abcd', type: `${T}.unknown`, payload: {}, runAt: new Date(Date.now() - 5 * 60_000), createdAt: new Date() });
    expect(await queue.runDue()).toBe(0);
    const after = await queue.summary();
    expect(after.pending).toBe(before.pending + 1);
    expect(after.oldestDueMinutes).toBeGreaterThanOrEqual(4);
  });
});
