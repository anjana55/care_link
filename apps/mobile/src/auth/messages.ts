import { ApiError } from '@/api';

/**
 * What to tell the person when a call fails. The API writes its messages in
 * the reader's language, so an API refusal is shown as it came; anything else
 * (no connection) gets the screen's own fallback.
 */
export function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}
