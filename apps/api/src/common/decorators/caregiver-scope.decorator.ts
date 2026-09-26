import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../database/schema/users.schema';

export const CAREGIVER_SCOPE_KEY = 'caregiverScope';

/**
 * Marks a route as accessible to either:
 *  - a staff user whose role is in `staffRoles` (defaults to
 *    ADMIN/STAFF/VERIFIER - the pre-existing staff set), or
 *  - a CAREGIVER-role user whose JWT `caregiverId` matches the route's
 *    `:id` or `:caregiverId` param (i.e. their own record).
 *
 * Use this in place of `@Roles()` on any endpoint under
 * /caregivers/:id or /caregivers/:caregiverId/... that a caregiver should
 * be able to use for their own record. For endpoints no caregiver should
 * ever touch regardless of ownership (the caregiver list/search, audit
 * logs, user management), keep using plain `@Roles()` instead.
 */
export const CaregiverScope = (...staffRoles: UserRole[]) =>
  SetMetadata(CAREGIVER_SCOPE_KEY, { staffRoles: staffRoles.length ? staffRoles : ['ADMIN', 'STAFF', 'VERIFIER'] });
