import type { JobsService } from '../jobs/jobs.service';
import type { AutomationService } from '../automation/automation.service';

export const BOOKING_SWEEP_JOB = 'booking-agent.sweep';
/** "Look at this request now" - queued when a caregiver accepts a job offer. */
export const BOOKING_REQUEST_JOB = 'booking-agent.request';

/**
 * Asks the booking agent to look at one request straight away rather than at
 * its next sweep. It only queues a job, queues nothing while Booking is
 * Manual, and a failure to queue is never the caller's problem.
 */
export async function nudgeBooking(jobs: JobsService, automation: AutomationService, requestId: string): Promise<void> {
  try {
    if ((await automation.gate('booking.create_draft')).mode === 'MANUAL') return;
    await jobs.enqueue(BOOKING_REQUEST_JOB, { requestId }, { maxAttempts: 3 });
  } catch {
    /* the five-minute sweep will pick it up */
  }
}

/** "Look at this booking now" - queued when a client accepts the draft they were asked to check. */
export const BOOKING_CONFIRM_JOB = 'booking-agent.booking';

export async function nudgeBookingConfirm(jobs: JobsService, automation: AutomationService, bookingId: string): Promise<void> {
  try {
    if ((await automation.gate('booking.confirm')).mode === 'MANUAL') return;
    await jobs.enqueue(BOOKING_CONFIRM_JOB, { bookingId }, { maxAttempts: 3 });
  } catch {
    /* the five-minute sweep will pick it up */
  }
}
