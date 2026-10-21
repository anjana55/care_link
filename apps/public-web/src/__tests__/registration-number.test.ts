import { isRegistrationNumber, normaliseRegistrationNumber } from '@/lib/registration-number';

describe('registration number helpers', () => {
  it.each(['CG-2026-123456', 'cg-2026-123456', 'CG2026123456', 'cg 2026 123456', 'CG–2026–123456', '  CG-2026-123456  '])(
    'normalises %p',
    (input) => {
      expect(isRegistrationNumber(input)).toBe(true);
      expect(normaliseRegistrationNumber(input)).toBe('CG-2026-123456');
    },
  );

  it.each(['', 'CG-2026', '2026-123456', 'someone@example.com', 'ADD A WAY TO CHANGE CAREGIVER EMAIL ADDRESS'])('rejects %p', (input) => {
    expect(isRegistrationNumber(input)).toBe(false);
  });
});
