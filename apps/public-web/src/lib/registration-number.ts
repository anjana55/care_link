/**
 * Caregiver registration numbers look like CG-2026-123456. People read them
 * off a phone screen or a printout and type them back as "cg 2026 123456",
 * "CG2026123456" or with an en dash, so all of those are normalised to the
 * canonical form before we show or send them.
 *
 * Mirrors normaliseRegistrationNumber() in apps/api/src/account-access/
 * identity.util.ts - keep the two in step.
 */
const PATTERN = /^CG\W*(\d{4})\W*(\d{4,8})$/;

export function normaliseRegistrationNumber(input: string): string {
  const upper = (input ?? '').trim().toUpperCase().replace(/[‐-―]/g, '-');
  const m = PATTERN.exec(upper);
  return m ? `CG-${m[1]}-${m[2]}` : upper;
}

/** True when the input, once normalised, has the shape of a registration number. */
export function isRegistrationNumber(input: string): boolean {
  return PATTERN.test((input ?? '').trim().toUpperCase().replace(/[‐-―]/g, '-'));
}
