import type { JobsService } from '../jobs/jobs.service';
import type { AutomationService } from '../automation/automation.service';

export const LIVE_CARE_SWEEP_JOB = 'live-care-agent.sweep';
/** "Look at this shift now" - queued when a caregiver checks out, so the shift is marked done without waiting for the sweep. */
export const LIVE_CARE_SHIFT_JOB = 'live-care-agent.shift';

/** Queues nothing while Live care is Manual; a failure to queue is never the caller's problem. */
export async function nudgeLiveCare(jobs: JobsService, automation: AutomationService, shiftId: string): Promise<void> {
  try {
    if ((await automation.gate('live_care.complete_shift')).mode === 'MANUAL') return;
    await jobs.enqueue(LIVE_CARE_SHIFT_JOB, { shiftId }, { maxAttempts: 3 });
  } catch {
    /* the sweep will pick it up */
  }
}
