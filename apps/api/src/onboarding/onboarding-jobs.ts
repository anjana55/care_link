import type { AutomationService } from '../automation/automation.service';
import type { JobsService } from '../jobs/jobs.service';

/** "Look at this caregiver now": a document uploaded, a reference added or answered. */
export const ONBOARDING_CAREGIVER_JOB = 'onboarding-agent.caregiver';
export const ONBOARDING_SWEEP_JOB = 'onboarding-agent.sweep';

/** Queues nothing while Onboarding is Manual, and never fails the caller: the regular pass reaches the caregiver anyway. */
export async function nudgeOnboarding(jobs: JobsService | undefined, automation: AutomationService | undefined, caregiverId: string): Promise<void> {
  if (!jobs || !automation) return;
  try {
    if ((await automation.gate('onboarding.recommend_verification')).mode === 'MANUAL') return;
    await jobs.enqueue(ONBOARDING_CAREGIVER_JOB, { caregiverId }, { maxAttempts: 3 });
  } catch {
    /* the sweep will reach it */
  }
}
