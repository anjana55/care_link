/**
 * What every phone field in the forms, the app and the API accepts.
 *
 * Only what people type into a phone number - digits, spaces, a leading +,
 * and - ( ) . as separators - with between `minDigits` and 15 digits (the
 * longest international number). Counting characters instead let a name
 * through: "W B M Wijesinghe" is 16 characters and no digits, and was saved
 * as an emergency contact number.
 *
 * This is the shape check only. Where a number must be reachable (sign-in,
 * WhatsApp), the API still normalises it to E.164 on top of this.
 */
export const PHONE_MIN_DIGITS = 9;
export const PHONE_MAX_DIGITS = 15;

export function isPhoneNumber(value: string | null | undefined, minDigits = PHONE_MIN_DIGITS): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!/^\+?[\d\s().-]+$/.test(v)) return false;
  const digits = v.replace(/\D/g, '').length;
  return digits >= minDigits && digits <= PHONE_MAX_DIGITS;
}
