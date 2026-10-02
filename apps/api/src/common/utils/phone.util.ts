/**
 * Phone-number helpers for WhatsApp sign-in.
 *
 * The rest of the app stores phone numbers exactly as typed (caregivers.primaryPhone,
 * patients.phone), so the same person can legitimately appear as "0771234567",
 * "+94 77 123 4567" or "94771234567". WhatsApp identity needs one canonical form
 * (E.164) for the unique key and for the Cloud API, plus a way to recognise the
 * other spellings when checking for duplicate accounts.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises user input to E.164, or returns null when it can't be a valid
 * number. `defaultCountryCode` (digits only, e.g. "94") is applied to national
 * numbers written with a leading 0 or with no prefix at all.
 */
export function normalizePhone(input: string | null | undefined, defaultCountryCode: string): string | null {
  if (!input) return null;
  const cc = defaultCountryCode.replace(/\D/g, '');
  let raw = input.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(raw.replace(/^00/, '+'))) return null;

  let candidate: string;
  if (raw.startsWith('+')) {
    candidate = raw;
  } else if (raw.startsWith('00')) {
    candidate = `+${raw.slice(2)}`;
  } else if (raw.startsWith('0')) {
    candidate = `+${cc}${raw.slice(1)}`;
  } else if (cc && raw.startsWith(cc) && raw.length > cc.length + 6) {
    candidate = `+${raw}`;
  } else {
    candidate = `+${cc}${raw}`;
  }

  return E164.test(candidate) ? candidate : null;
}

/**
 * Every spelling of an E.164 number that might already be stored in a free-text
 * phone column: E.164, digits-only, and the national form with a leading 0.
 */
export function phoneVariants(e164: string, defaultCountryCode: string): string[] {
  const cc = defaultCountryCode.replace(/\D/g, '');
  const digits = e164.replace(/^\+/, '');
  const variants = new Set<string>([e164, digits]);
  if (cc && digits.startsWith(cc)) {
    const national = digits.slice(cc.length);
    variants.add(`0${national}`);
    variants.add(national);
  }
  return [...variants];
}

/** Digits-only form used when handing the number to the WhatsApp Cloud API. */
export function toWhatsappRecipient(e164: string): string {
  return e164.replace(/^\+/, '');
}
