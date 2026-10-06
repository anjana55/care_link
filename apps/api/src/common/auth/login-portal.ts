import { UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '../../database/schema';

/**
 * The three places a person can sign in, and which accounts each one serves.
 *
 * A login screen says which of them it is (the `portal` field) and the API holds
 * it to that: correct credentials for an account that belongs to a different
 * portal are refused exactly like a wrong password. That keeps a staff member
 * who opens the public site (or a caregiver who opens the staff app) from being
 * handed a session the screen cannot use, and it stops a login page from being
 * used to learn that a given email and password are valid for another area.
 */
export const LOGIN_PORTALS = ['staff', 'caregiver', 'customer'] as const;
export type LoginPortal = (typeof LOGIN_PORTALS)[number];

export const PORTAL_ROLES: Record<LoginPortal, readonly UserRole[]> = {
  staff: ['ADMIN', 'STAFF', 'VERIFIER'],
  caregiver: ['CAREGIVER'],
  customer: ['PATIENT_GUARDIAN'],
};

export function canUsePortal(role: UserRole, portal: LoginPortal): boolean {
  return PORTAL_ROLES[portal].includes(role);
}

/**
 * Correct credentials, wrong portal. Indistinguishable from a wrong password on
 * the wire - same status, same message, same body - but a distinct type so the
 * controller can write it to the audit log, where staff can see it.
 */
export class WrongPortalException extends UnauthorizedException {
  constructor(
    readonly userId: string,
    readonly portal: LoginPortal,
  ) {
    super('Invalid credentials');
  }
}
