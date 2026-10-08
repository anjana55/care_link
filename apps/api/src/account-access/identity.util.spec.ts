import { isClaimable, normaliseRegistrationNumber } from './identity.util';
import { ClaimCodesService } from './claim-codes.service';

describe('isClaimable - which accounts the registration-number flow may finish', () => {
  const caregiver = (passwordHash: string | null = null, isActive = true, role = 'CAREGIVER') => ({ isActive, role, passwordHash });

  it('allows a login with no password and no provider link (registered, never secured)', () => {
    expect(isClaimable({ caregiverDeleted: false, user: caregiver(), linkedProviderCount: 0 })).toBe(true);
  });

  it('allows a staff-entered caregiver with no login at all', () => {
    expect(isClaimable({ caregiverDeleted: false, user: null, linkedProviderCount: 0 })).toBe(true);
  });

  it('refuses an account with a linked provider - a code must never take over a working sign-in', () => {
    expect(isClaimable({ caregiverDeleted: false, user: caregiver(), linkedProviderCount: 1 })).toBe(false);
  });

  it('refuses an account with a password', () => {
    expect(isClaimable({ caregiverDeleted: false, user: caregiver('$2b$hash'), linkedProviderCount: 0 })).toBe(false);
  });

  it('refuses a deleted caregiver, a deactivated login and a non-caregiver login', () => {
    expect(isClaimable({ caregiverDeleted: true, user: caregiver(), linkedProviderCount: 0 })).toBe(false);
    expect(isClaimable({ caregiverDeleted: false, user: caregiver(null, false), linkedProviderCount: 0 })).toBe(false);
    expect(isClaimable({ caregiverDeleted: false, user: caregiver(null, true, 'STAFF'), linkedProviderCount: 0 })).toBe(false);
  });
});

describe('normaliseRegistrationNumber', () => {
  it.each([
    ['CG-2026-123456', 'CG-2026-123456'],
    ['cg-2026-123456', 'CG-2026-123456'],
    [' CG 2026 123456 ', 'CG-2026-123456'],
    ['CG2026123456', 'CG-2026-123456'],
    ['CG\u20132026\u2013123456', 'CG-2026-123456'],
    ['CG-2026-0001', 'CG-2026-0001'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseRegistrationNumber(input)).toBe(expected);
  });

  it('leaves something that is not a registration number alone (it simply will not match)', () => {
    expect(normaliseRegistrationNumber('hello')).toBe('HELLO');
  });
});

describe('ClaimCodesService code shapes', () => {
  it('treats spacing, dashes and case as the same code', () => {
    expect(ClaimCodesService.canonical('abcd-ef9h')).toBe('ABCDEF9H');
    expect(ClaimCodesService.canonical(' 482 915 ')).toBe('482915');
  });

  it('tells a staff code (has letters) from a numeric WhatsApp/email code', () => {
    expect(ClaimCodesService.looksLikeStaffCode('ab2c-de3f')).toBe(true);
    expect(ClaimCodesService.looksLikeStaffCode('482915')).toBe(false);
  });
});
