import { maskIdentifier, maskPhone } from './masking.util';

describe('maskIdentifier', () => {
  it('masks all but the last 4 characters', () => {
    expect(maskIdentifier('199912345678')).toBe('********5678');
  });

  it('returns null for null/undefined input', () => {
    expect(maskIdentifier(null)).toBeNull();
    expect(maskIdentifier(undefined)).toBeNull();
  });

  it('masks entirely when the value is 4 characters or shorter', () => {
    expect(maskIdentifier('123')).toBe('***');
  });
});

describe('maskPhone', () => {
  it('keeps the first 3 and last 3 digits visible', () => {
    expect(maskPhone('0771234567')).toBe('077****567');
  });

  it('returns null for null/undefined input', () => {
    expect(maskPhone(null)).toBeNull();
  });
});
