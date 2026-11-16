import type { JobsService } from '../jobs/jobs.service';

/** An invoice has just been paid in full: if a booking was waiting for it, staff and the booking agent are told. */
export const INVOICE_PAID_JOB = 'advance-payment.paid';
/** The hourly look for bookings still waiting for their first payment. */
export const UNPAID_SWEEP_JOB = 'advance-payment.unpaid-sweep';

/** Queued, not called: recording a payment must never fail or wait because of what follows from it. */
export async function invoicePaid(jobs: JobsService, invoiceId: string): Promise<void> {
  try {
    await jobs.enqueue(INVOICE_PAID_JOB, { invoiceId }, { maxAttempts: 3 });
  } catch {
    /* staff still see the invoice as paid and can confirm the booking */
  }
}
