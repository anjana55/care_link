import type { AuthUser } from './api/auth-context';

/**
 * Where "My account" goes for each kind of signed-in visitor. Kept out of
 * auth-context so components can use it without pulling in (or, in tests,
 * mocking) the whole session provider.
 */
export function accountHome(user: Pick<AuthUser, 'role'>): string {
  return user.role === 'PATIENT_GUARDIAN' ? '/account/requests' : user.role === 'EMPLOYER' ? '/employer' : '/caregiver/dashboard';
}
