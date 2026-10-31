import type { Locale } from '@care-platform/shared/i18n';

/** A refused request. `message` is the API's own, already in the reader's language. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The public site's wording (apps/public-web/src/lib/api/client.ts), so both
// say the same thing in the same three languages.
const SESSION_EXPIRED: Record<Locale, string> = {
  en: 'Your session has expired. Please sign in again.',
  si: 'ඔබගේ සැසිය කල් ඉකුත් වී ඇත. කරුණාකර නැවත පුරනය වන්න.',
  ta: 'உங்கள் அமர்வு காலாவதியாகிவிட்டது. மீண்டும் உள்நுழையவும்.',
};

const SESSION_CHECK_FAILED: Record<Locale, string> = {
  en: "We couldn't confirm you're signed in. Please check your connection and try again.",
  si: 'ඔබ පුරනය වී ඇති බව තහවුරු කළ නොහැකි විය. කරුණාකර ඔබේ සම්බන්ධතාවය පරීක්ෂා කර නැවත උත්සාහ කරන්න.',
  ta: 'நீங்கள் உள்நுழைந்துள்ளீர்கள் என்பதை உறுதிப்படுத்த முடியவில்லை. உங்கள் இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
};

/** The session has ended (refresh refused): the person has to sign in again. */
export class SessionExpiredError extends ApiError {
  constructor(locale: Locale) {
    super(401, SESSION_EXPIRED[locale] ?? SESSION_EXPIRED.en);
    this.name = 'SessionExpiredError';
  }
}

/**
 * The access token was refused and the refresh couldn't finish for a reason
 * that says nothing about the session - no signal, a server error. The session
 * is kept; it may well be fine once the phone is back online.
 */
export class SessionCheckFailedError extends ApiError {
  constructor(locale: Locale) {
    super(401, SESSION_CHECK_FAILED[locale] ?? SESSION_CHECK_FAILED.en);
    this.name = 'SessionCheckFailedError';
  }
}

/** No answer at all: offline, or the API unreachable. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}
