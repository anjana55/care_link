import { resolveLanguage } from './language';

describe('resolveLanguage', () => {
  it('defaults to English', () => {
    expect(resolveLanguage(undefined, undefined)).toBe('en');
    expect(resolveLanguage('', '')).toBe('en');
  });

  it('honours the lang parameter, in any case and with a region', () => {
    expect(resolveLanguage('si', undefined)).toBe('si');
    expect(resolveLanguage('TA', undefined)).toBe('ta');
    expect(resolveLanguage('si-LK', undefined)).toBe('si');
    expect(resolveLanguage('ta_IN', undefined)).toBe('ta');
  });

  it('lets lang override Accept-Language, because it is the explicit one', () => {
    expect(resolveLanguage('si', 'ta,en;q=0.5')).toBe('si');
  });

  it('reads Accept-Language by preference, not by position', () => {
    expect(resolveLanguage(undefined, 'ta-LK')).toBe('ta');
    expect(resolveLanguage(undefined, 'en;q=0.4,si;q=0.9')).toBe('si');
    expect(resolveLanguage(undefined, 'fr,de;q=0.9,si;q=0.5')).toBe('si');
    // Equal weight: the earlier one.
    expect(resolveLanguage(undefined, 'ta,si')).toBe('ta');
  });

  it('skips a language the caller has ruled out with q=0', () => {
    expect(resolveLanguage(undefined, 'si;q=0,ta;q=0.1')).toBe('ta');
  });

  it('ignores what it does not support instead of failing', () => {
    expect(resolveLanguage('fr', undefined)).toBe('en');
    expect(resolveLanguage('fr', 'si')).toBe('si'); // an unsupported lang falls through to the header
    expect(resolveLanguage(undefined, 'fr,de')).toBe('en');
    expect(resolveLanguage(['si'], undefined)).toBe('en'); // ?lang=si&lang=ta arrives as an array
    expect(resolveLanguage(undefined, ';;,,q=')).toBe('en');
  });
});
