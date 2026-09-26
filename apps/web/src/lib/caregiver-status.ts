import type { CaregiverStatus } from './api/types';

export const CAREGIVER_STATUS_OPTIONS: CaregiverStatus[] = [
  'DRAFT',
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'UNDER_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'REJECTED',
];

const TRANSITIONS: Record<CaregiverStatus, CaregiverStatus[]> = {
  DRAFT: ['REGISTERED'],
  REGISTERED: ['DOCUMENTS_PENDING', 'REJECTED'],
  DOCUMENTS_PENDING: ['UNDER_VERIFICATION', 'REJECTED'],
  UNDER_VERIFICATION: ['VERIFIED', 'REJECTED', 'DOCUMENTS_PENDING'],
  VERIFIED: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  REJECTED: [],
};

// This mirrors the authoritative state machine enforced server-side in
// apps/api/src/database/schema/caregivers.schema.ts - it only drives which
// options the dropdown offers; the API is what actually enforces the rule.
export function allowedNextStatuses(current: CaregiverStatus): CaregiverStatus[] {
  return TRANSITIONS[current] ?? [];
}
