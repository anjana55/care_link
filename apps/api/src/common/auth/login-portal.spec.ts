import { JwtService } from '@nestjs/jwt';
import {
  decodePublicAuthUser,
  isTokenExpired,
  loginPortalValues,
  publicRoleValues,
  type PublicLoginPortal,
} from '@care-platform/shared';
import { userRoleEnum, type UserRole } from '../../database/schema';
import { LOGIN_PORTALS, PORTAL_ROLES } from './login-portal';
import type { JwtPayload } from '../../auth/strategies/jwt.strategy';

/**
 * The public site and the mobile app decide who may hold a session with the
 * shared decodePublicAuthUser. These pin it to what the API itself enforces at
 * sign-in (PORTAL_ROLES), against tokens signed exactly as AuthService signs
 * them - so neither side can drift without a test failing.
 */
describe('shared sign-in rules agree with the API', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const sign = (payload: JwtPayload, expiresIn: string | number = '15m') =>
    jwt.sign(payload, { expiresIn: expiresIn as never });
  // The API's own answer to "who may sign in outside the staff app" - the
  // expectation below comes from here, never from the shared list under test.
  const servedOutsideStaff = new Set<UserRole>(
    LOGIN_PORTALS.filter((p) => p !== 'staff').flatMap((p) => PORTAL_ROLES[p]),
  );

  it('uses the shared list of portals', () => {
    expect(LOGIN_PORTALS).toBe(loginPortalValues);
  });

  it('allows a session outside the staff app for exactly the roles the non-staff portals serve', () => {
    const publicPortals = LOGIN_PORTALS.filter((p): p is PublicLoginPortal => p !== 'staff');
    const served = new Set(publicPortals.flatMap((p) => PORTAL_ROLES[p]));
    expect([...served].sort()).toEqual([...publicRoleValues].sort());
    for (const staffRole of PORTAL_ROLES.staff) {
      expect(publicRoleValues as readonly string[]).not.toContain(staffRole);
    }
  });

  it.each(userRoleEnum.map((role) => [role]))('decodes or refuses a real %s token as the API would', (role: UserRole) => {
    const token = sign({ sub: 'u-1', email: null, phone: '+94771234567', role, caregiverId: 'cg-1' });
    const user = decodePublicAuthUser(token);
    if (servedOutsideStaff.has(role)) {
      expect(user).toEqual({
        userId: 'u-1',
        email: null,
        phone: '+94771234567',
        role,
        caregiverId: 'cg-1',
        patientId: undefined,
        employerId: undefined,
      });
    } else {
      expect(user).toBeNull();
    }
  });

  it('keeps an email address written in any script intact', () => {
    // Non-ASCII survives the base64url -> UTF-8 step (the bug class the old inline decoder fixed).
    const email = 'කමල්@example.lk';
    const user = decodePublicAuthUser(sign({ sub: 'u-2', email, role: 'PATIENT_GUARDIAN', patientId: 'p-1' }));
    expect(user?.email).toBe(email);
    expect(user?.patientId).toBe('p-1');
  });

  it('refuses things that are not tokens', () => {
    for (const junk of ['', 'abc', 'a.b.c', 'a.%%%.c', 'eyJhbGciOiJIUzI1NiJ9.bnVsbA.x']) {
      expect(decodePublicAuthUser(junk)).toBeNull();
    }
  });

  it('reads expiry from the token, with slack for clock drift', () => {
    const fresh = sign({ sub: 'u-3', email: null, role: 'CAREGIVER' }, '15m');
    const stale = sign({ sub: 'u-3', email: null, role: 'CAREGIVER' }, -60);
    const almost = sign({ sub: 'u-3', email: null, role: 'CAREGIVER' }, 2);
    expect(isTokenExpired(fresh)).toBe(false);
    expect(isTokenExpired(stale)).toBe(true);
    expect(isTokenExpired(almost)).toBe(true); // within the default 5 s of slack
    expect(isTokenExpired(almost, 0)).toBe(false);
  });
});
