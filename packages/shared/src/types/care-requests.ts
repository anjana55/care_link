import type { PublicCaregiverProfile } from './public-search';
import type { CareType } from './care-types';

/**
 * The client-facing contract for "Contact this caregiver" and "Save this
 * caregiver" (apps/public-web <-> /me/care-requests and /me/saved-caregivers).
 *
 * Contact is staff-mediated, so nothing here carries a caregiver's name, phone,
 * email or internal id - only the same anonymous public profile the search
 * results show. Staff notes and the staff member's identity are not part of it
 * either.
 */
export type CareRequestStatus = 'NEW' | 'IN_PROGRESS' | 'INTRODUCED' | 'CLOSED' | 'CANCELLED';

export const CARE_REQUEST_STATUSES: readonly CareRequestStatus[] = ['NEW', 'IN_PROGRESS', 'INTRODUCED', 'CLOSED', 'CANCELLED'];

/** Statuses the client may still cancel from. */
export const CLIENT_CANCELLABLE_STATUSES: readonly CareRequestStatus[] = ['NEW', 'IN_PROGRESS'];

/** Longest message a client can send with a request. */
export const CARE_REQUEST_MESSAGE_MAX = 1000;

export interface ClientCareRequest {
  id: string;
  /** Short handle the client can quote on a call, e.g. "CR-7K2QM9". */
  reference: string;
  status: CareRequestStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  /**
   * Null while our team is still finding a caregiver - a request taken over
   * the phone can start without one.
   */
  caregiverPublicId: string | null;
  /**
   * The caregiver's public profile, or null when there is no caregiver yet or
   * the one chosen is not shown on the public site (staff may match someone
   * who is not listed).
   */
  caregiver: PublicCaregiverProfile | null;
  /** What kind of care was asked for, when known. */
  careType: CareType | null;
  /** Where the care is needed, in the client's language, when given. */
  district: string | null;
  city: string | null;
  desiredStartDate: string | null;
}

/**
 * POST /me/care-requests. Without a caregiver it is an "ask the team to find
 * someone" request; then the care type and the district are required so staff
 * have something to match on.
 */
export interface CreateCareRequestBody {
  caregiverPublicId?: string;
  message?: string;
  careType?: CareType;
  districtId?: number;
  cityId?: number;
  desiredStartDate?: string;
}

/** GET /me/saved-caregivers */
export interface SavedCaregiverItem {
  caregiverPublicId: string;
  savedAt: string;
  /** Null when the caregiver is no longer publicly listed. */
  caregiver: PublicCaregiverProfile | null;
}

/**
 * GET /me/caregiver-relations?publicIds=... - whether the signed-in client has
 * saved, or has an open request for, each caregiver on screen. Lets a results
 * page or profile draw the right button state with one call.
 */
export interface CaregiverRelation {
  caregiverPublicId: string;
  saved: boolean;
  /** The client's open (NEW or IN_PROGRESS) request for this caregiver, if any. */
  openRequest: { id: string; reference: string; status: CareRequestStatus } | null;
}
