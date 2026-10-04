import type { ClientStatus } from './api/types';

export const CLIENT_STATUS_OPTIONS: ClientStatus[] = [
  'PENDING_REVIEW',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
];

const TRANSITIONS: Record<ClientStatus, ClientStatus[]> = {
  PENDING_REVIEW: ['ACTIVE', 'INACTIVE'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE'],
  SUSPENDED: ['ACTIVE'],
};

// This mirrors the authoritative state machine enforced server-side in
// apps/api/src/database/schema/patients.schema.ts (CLIENT_STATUS_TRANSITIONS,
// enforced in PatientsService.updateStatus) - it only drives which options the
// dropdown offers; the API is what actually enforces the rule.
//
// Offering all four statuses, as the dropdown did before, means every illegal
// pick is a 400 with no way to explain it in the UI.
export function allowedNextClientStatuses(current: ClientStatus): ClientStatus[] {
  return TRANSITIONS[current] ?? [];
}