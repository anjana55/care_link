import type { AutomationService } from '../automation/automation.service';
import type { JobsService } from '../jobs/jobs.service';

/** "Look at this request now": a new request, or the client has just added details. */
export const INTAKE_REQUEST_JOB = 'intake-agent.request';
export const INTAKE_SWEEP_JOB = 'intake-agent.sweep';

/** Queues nothing while Intake is Manual, and never fails the caller: the regular pass reaches the request anyway. */
export async function nudgeIntake(jobs: JobsService, automation: AutomationService, requestId: string): Promise<void> {
  try {
    if ((await automation.gate('intake.ask_client')).mode === 'MANUAL') return;
    await jobs.enqueue(INTAKE_REQUEST_JOB, { requestId }, { maxAttempts: 3 });
  } catch {
    /* the sweep will reach it */
  }
}
