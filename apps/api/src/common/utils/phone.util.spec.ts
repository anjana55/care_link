import { normalizePhone, phoneVariants, toWhatsappRecipient } from './phone.util';

describe('normalizePhone', () => {
  it.each([
    ['0771234567', '+94771234567'],
    ['077 123 4567', '+94771234567'],
    ['077-123-4567', '+94771234567'],
    ['+94771234567', '+94771234567'],
    ['+94 77 123 4567', '+94771234567'],
    ['0094771234567', '+94771234567'],
    ['94771234567', '+94771234567'],
    ['771234567', '+94771234567'],
    ['+447911123456', '+447911123456'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizePhone(input, '94')).toBe(expected);
  });

  it.each(['', '   ', 'abc', '07712', '+0771234567', '12', '+94-77-abc', '++94771234567', '0'.repeat(30)])(
    'rejects %p',
    (input) => {
      expect(normalizePhone(input, '94')).toBeNull();
    },
  );

  it('returns null for null/undefined', () => {
    expect(normalizePhone(null, '94')).toBeNull();
    expect(normalizePhone(undefined, '94')).toBeNull();
  });

  it('honours a different default country code', () => {
    expect(normalizePhone('07911123456', '44')).toBe('+447911123456');
  });
});

describe('phoneVariants', () => {
  it('lists every stored spelling of a Sri Lankan number', () => {
    expect(phoneVariants('+94771234567', '94').sort()).toEqual(
      ['+94771234567', '94771234567', '0771234567', '771234567'].sort(),
    );
  });

  it('only adds national forms for the default country', () => {
    expect(phoneVariants('+447911123456', '94').sort()).toEqual(['+447911123456', '447911123456'].sort());
  });
});

describe('toWhatsappRecipient', () => {
  it('drops the plus sign', () => {
    expect(toWhatsappRecipient('+94771234567')).toBe('94771234567');
  });
});
