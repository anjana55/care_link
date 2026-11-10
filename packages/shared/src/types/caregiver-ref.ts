/**
 * The caregiver ID customers see: "Caregiver abcd1234" on search results,
 * profiles, saved lists and the mobile app. It is the first
 * CAREGIVER_REF_LENGTH characters of the caregiver's `public_id` (a UUID),
 * never the internal `id` or the registration number.
 *
 * Customers read this ID out to staff over the phone, so every staff search
 * that finds caregivers also accepts it - see `caregiverRefSearchPrefix`.
 * New caregivers get a `public_id` whose ref is not already taken (apps/api
 * `generateUniquePublicId`), so the short ID points at one caregiver.
 */
export const CAREGIVER_REF_LENGTH = 8;

/** Shortest hex run accepted as a (partial) caregiver ID in a search box. */
export const CAREGIVER_REF_MIN_SEARCH_LENGTH = 6;

/** The short ID shown for a caregiver, from their full public id. */
export function caregiverRef(publicId: string): string {
  return publicId.slice(0, CAREGIVER_REF_LENGTH);
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Words people put around the ID when they read or paste it: "Caregiver
// abcd1234" (en), the si/ta labels, "ID", "#", "no.".
const LABEL_WORDS = /^(caregiver|සාත්තු\s*සේවක|பராமரிப்பாளர்|id|ref|no\.?|#|:)+/iu;

/**
 * If a search term looks like a caregiver ID - "abcd1234", "ABCD 1234",
 * "Caregiver ABCD-1234", "#abcd1234", a full public id, or a pasted public
 * profile link - returns the `public_id` prefix to match with
 * `LIKE '<prefix>%'` (lower case, dashes where a UUID has them). Otherwise
 * null, so the caller only searches its usual columns.
 *
 * Callers OR this with their name/reference matches rather than replacing
 * them, so a term that happens to be hex (a phone number is all digits) can
 * only add a match, never hide one.
 */
export function caregiverRefSearchPrefix(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  const uuid = raw.match(UUID_IN_TEXT);
  if (uuid) return uuid[0].toLowerCase();

  let rest = raw.toLowerCase();
  // Strip leading label words, with any spacing between them.
  for (let i = 0; i < 4; i++) {
    const next = rest.replace(/^\s+/, '').replace(LABEL_WORDS, '');
    if (next === rest) break;
    rest = next;
  }
  const hex = rest.replace(/[\s-]/g, '');
  if (hex.length < CAREGIVER_REF_MIN_SEARCH_LENGTH || hex.length > 32) return null;
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  // Re-insert the UUID dashes so the prefix lines up with the stored value.
  const groups = [8, 4, 4, 4, 12];
  let out = '';
  let pos = 0;
  for (const size of groups) {
    if (pos >= hex.length) break;
    if (pos > 0) out += '-';
    out += hex.slice(pos, pos + size);
    pos += size;
  }
  // Only hex digits and dashes, so it is safe inside a LIKE pattern.
  return out;
}
