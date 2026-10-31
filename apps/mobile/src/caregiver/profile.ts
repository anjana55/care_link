import type { CaregiverStatus, OwnCaregiver } from '@care-platform/shared';

/**
 * The caregiver's own details that the app lets them change - contact,
 * address and emergency contact, which the API always accepts - with the
 * website's rules (apps/public-web/src/lib/schemas/personal-info.ts).
 *
 * Identity (name, date of birth, gender, ID numbers) is shown, not edited:
 * the API locks it once verification starts, and before that it is corrected
 * on the website. Keep IDENTITY_EDITABLE in step with the API's
 * IDENTITY_EDITABLE_STATUSES.
 */
export const IDENTITY_EDITABLE: ReadonlySet<CaregiverStatus> = new Set<CaregiverStatus>(['DRAFT', 'REGISTERED', 'DOCUMENTS_PENDING']);
export const identityLocked = (status: CaregiverStatus) => !IDENTITY_EDITABLE.has(status);

export const CONTACT_METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export interface ContactDetails {
  permanentAddress: string;
  districtId: number | null;
  cityId: number | null;
  secondaryPhone: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelationship: string;
  preferredContactMethod: ContactMethod | null;
}
export type ContactField = keyof ContactDetails;

export function contactDetailsOf(c: OwnCaregiver): ContactDetails {
  return {
    permanentAddress: c.permanentAddress ?? '',
    districtId: c.districtId ?? null,
    cityId: c.cityId ?? null,
    secondaryPhone: c.secondaryPhone ?? '',
    emergencyContactName: c.emergencyContactName ?? '',
    emergencyContactNumber: c.emergencyContactNumber ?? '',
    emergencyContactRelationship: c.emergencyContactRelationship ?? '',
    preferredContactMethod: (c.preferredContactMethod as ContactMethod | null) ?? null,
  };
}

/**
 * What's wrong, as message keys under personalInfo.validation (the website's
 * messages): field → 'required' | 'invalid'. Empty when the form can be saved.
 */
export function problemsIn(v: ContactDetails): Partial<Record<'permanentAddress' | 'district' | 'city' | 'emergencyContactName' | 'emergencyContactNumber' | 'emergencyContactRelationship', 'required' | 'invalid'>> {
  const problems: ReturnType<typeof problemsIn> = {};
  const text = (field: 'permanentAddress' | 'emergencyContactName' | 'emergencyContactRelationship', min: number) => {
    const value = v[field].trim();
    if (!value) problems[field] = 'required';
    else if (value.length < min) problems[field] = 'invalid';
  };
  text('permanentAddress', 5);
  if (v.districtId === null) problems.district = 'required';
  if (v.cityId === null) problems.city = 'required';
  text('emergencyContactName', 2);
  const number = v.emergencyContactNumber.trim();
  if (!number) problems.emergencyContactNumber = 'required';
  else if (number.length < 9) problems.emergencyContactNumber = 'invalid';
  text('emergencyContactRelationship', 2);
  return problems;
}

/**
 * Only what changed, trimmed - the API takes a partial update, so nothing the
 * caregiver didn't touch is sent back (and can't trip a check on it). A
 * cleared second phone is sent as "", as the website does.
 */
export function changesBetween(before: ContactDetails, after: ContactDetails): Partial<Record<ContactField, string | number>> {
  const changes: Partial<Record<ContactField, string | number>> = {};
  for (const field of Object.keys(after) as ContactField[]) {
    const a = typeof after[field] === 'string' ? (after[field] as string).trim() : after[field];
    const b = typeof before[field] === 'string' ? (before[field] as string).trim() : before[field];
    if (a !== b && a !== null) changes[field] = a as string | number;
  }
  return changes;
}
