import { and, eq } from 'drizzle-orm';
import type { Database } from '../database/database.module';
import { requestOffers } from '../database/schema';
import type { JobsService } from '../jobs/jobs.service';

/** "This shift no longer needs cover": its waiting cover offers are withdrawn and the caregivers told. */
export const COVER_CLOSE_JOB = 'cover.close';

/**
 * Called when the shift's caregiver checks in after all. Queues the close only
 * when there are cover offers waiting, so an ordinary check-in costs one small
 * read. Accepting is refused once someone has checked in whether or not this
 * runs, so a failure here can never put two caregivers on one shift.
 */
export async function closeCoverOffers(db: Database, jobs: JobsService, shiftId: string): Promise<void> {
  try {
    const [open] = await db.select({ id: requestOffers.id }).from(requestOffers).where(and(eq(requestOffers.shiftId, shiftId), eq(requestOffers.status, 'OFFERED'))).limit(1);
    if (open) await jobs.enqueue(COVER_CLOSE_JOB, { shiftId }, { maxAttempts: 3 });
  } catch {
    /* the offers run out on their own within minutes */
  }
}
