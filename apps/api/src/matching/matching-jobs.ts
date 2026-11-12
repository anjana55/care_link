import type { JobsService } from '../jobs/jobs.service';
import type { AutomationService } from '../automation/automation.service';

export const MATCHING_SWEEP_JOB = 'matching-agent.sweep';
/** "Look at this request now" - queued when a request arrives and when an offer is answered or runs out. */
export const MATCHING_REQUEST_JOB = 'matching-agent.request';

/**
 * Asks the matching agent to look at one request straight away rather than at
 * its next sweep. Safe to call from anywhere: it only queues a job, queues nothing while Matching is
 * Manual, and a failure to queue is never the caller's problem.
 */
export async function nudgeMatching(jobs: JobsService, automation: AutomationService, requestId: string): Promise<void> {
  try {
    if ((await automation.gate('matching.send_offer')).mode === 'MANUAL') return;
    // No unique key: looking twice is harmless, and a second answer seconds after the first must not be lost.
    await jobs.enqueue(MATCHING_REQUEST_JOB, { requestId }, { maxAttempts: 3 });
  } catch {
    /* the five-minute sweep will pick it up */
  }
}
