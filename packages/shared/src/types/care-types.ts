/**
 * The kind of care a client is looking for. Asked on every search (mandatory),
 * carried into the request it leads to, and matched against what each
 * caregiver says they take on (availability.care_* columns).
 *
 * Order is the order the options are shown in.
 */
export const careTypeValues = ['HOME_SHIFT', 'LIVE_IN', 'HOSPITAL', 'NURSING_HOME', 'RETIREMENT_HOME'] as const;
export type CareType = (typeof careTypeValues)[number];

export function isCareType(value: unknown): value is CareType {
  return typeof value === 'string' && (careTypeValues as readonly string[]).includes(value);
}

/**
 * Caregiver statuses that are listed in public search: registered and every
 * step after it, up to and including active. Draft, inactive, suspended and
 * rejected caregivers are never shown.
 */
export const PUBLIC_CAREGIVER_STATUSES = ['REGISTERED', 'DOCUMENTS_PENDING', 'UNDER_VERIFICATION', 'VERIFIED', 'ACTIVE'] as const;

/** Statuses that earn the "Verified" badge on a public card or profile. */
export const VERIFIED_CAREGIVER_STATUSES = ['VERIFIED', 'ACTIVE'] as const;
