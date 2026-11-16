import type { AutomationService } from '../automation/automation.service';
import type { JobsService } from '../jobs/jobs.service';

/** "Look at this booking now": queued when a booking billed in advance is confirmed, or a booking is switched to advance. */
export const BILLING_BOOKING_JOB = 'billing-agent.booking';

/**
 * Asks the billing agent to look at one booking straight away instead of at
 * its next hourly pass. Queues nothing while Billing is Manual, and never
 * fails the caller: the hourly pass picks the booking up regardless.
 */
export async function nudgeBilling(jobs: JobsService, automation: AutomationService, bookingId: string): Promise<void> {
  try {
    if ((await automation.gate('billing.issue_invoice')).mode === 'MANUAL') return;
    await jobs.enqueue(BILLING_BOOKING_JOB, { bookingId }, { maxAttempts: 3 });
  } catch {
    /* the hourly pass will reach it */
  }
}
