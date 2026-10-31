import { ApiError } from '@/api';

/**
 * What to tell the person when a call fails. The API writes its messages in
 * the reader's language, so an API refusal is shown as it came; anything else
 * (no connection) gets the screen's own fallback.
 */
export function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

// The API's "Invalid credentials" in each language (apps/api/src/common/i18n/messages.ts).
// It's the answer for a wrong password, an unknown email and an account that
// belongs to the other side of the app alike.
const INVALID_CREDENTIALS = new Set(['Invalid credentials', 'පිවිසුම් අක්තපත්‍ර වලංගු නැත', 'உள்நுழைவுச் சான்றுகள் தவறானவை']);

/** True for the API's plain "wrong email or password"; false for any other refusal, which has its own message. */
export function isInvalidCredentials(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && INVALID_CREDENTIALS.has(error.message);
}
