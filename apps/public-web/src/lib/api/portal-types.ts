/**
 * Shapes returned by the API for a signed-in caregiver's own record. They live
 * in packages/shared/src/types/caregivers.ts - the mobile app uses them too,
 * and the API's database schema takes its value lists from there. Re-exported
 * under this app's existing names so its imports did not have to change.
 */
export {
  documentTypeValues as DOCUMENT_TYPES,
  shiftPreferenceValues as SHIFT_PREFERENCES,
  qualificationTypeValues as QUALIFICATION_TYPES,
} from '@care-platform/shared';
export type {
  CaregiverStatus,
  VerificationStatus,
  OwnCaregiver,
  CaregiverDocument,
  DocumentType,
  ShiftPreference,
  Availability,
  Qualification,
  Experience,
  NamedItem,
} from '@care-platform/shared';
