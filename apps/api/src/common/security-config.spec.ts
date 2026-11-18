import 'reflect-metadata';
import { validateEnv, weakSecrets } from './env.validation';
import { trustProxy } from './trust-proxy';

const strong = (c: string) => c.repeat(48);
const base = { DATABASE_URL: 'mysql://u:p@h/db', STORAGE_LOCAL_ROOT: './s' };

describe('signing keys in production', () => {
  it('accepts long, distinct, generated keys', () => {
    expect(weakSecrets({ JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b'), SETTINGS_ENCRYPTION_KEY: undefined })).toEqual([]);
    // Left blank in .env.production, as its comments allow.
    expect(weakSecrets({ JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b'), SETTINGS_ENCRYPTION_KEY: '' })).toEqual([]);
    // What setup.sh generates (openssl rand -base64 48).
    expect(weakSecrets({ JWT_ACCESS_SECRET: 'q3V0dGVyc2NvdGNoZXN0ZXJmaWVsZGhvdXNlZm9yZXN0bGlnaHRzdW5yaXNlYWJj', JWT_REFRESH_SECRET: 'dGVzdGRldnBhc3N3b3JkbW91bnRhaW5yaXZlcmJyaWRnZWNhbmRsZWZsYW1lYmx1ZQ==', SETTINGS_ENCRYPTION_KEY: undefined })).toEqual([]);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('b') })).not.toThrow();
  });

  it('refuses the .env.example values, short keys and one key used twice', () => {
    expect(weakSecrets({ JWT_ACCESS_SECRET: 'change-me-access-secret', JWT_REFRESH_SECRET: strong('b'), SETTINGS_ENCRYPTION_KEY: undefined })[0]).toMatch(/JWT_ACCESS_SECRET must be at least 32/);
    expect(weakSecrets({ JWT_ACCESS_SECRET: `change-me-${strong('a')}`, JWT_REFRESH_SECRET: strong('b'), SETTINGS_ENCRYPTION_KEY: undefined })[0]).toMatch(/still the example value/);
    expect(weakSecrets({ JWT_ACCESS_SECRET: strong('a'), JWT_REFRESH_SECRET: strong('a'), SETTINGS_ENCRYPTION_KEY: 'short' })).toEqual([
      expect.stringMatching(/SETTINGS_ENCRYPTION_KEY must be at least 32/),
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    ]);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'change-me-access-secret', JWT_REFRESH_SECRET: 'change-me-refresh-secret' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('leaves development alone', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development', JWT_ACCESS_SECRET: 'dev', JWT_REFRESH_SECRET: 'dev' })).not.toThrow();
  });
});

describe('trust proxy', () => {
  it('trusts only local and private networks by default, and can be switched off or set', () => {
    expect(trustProxy(undefined)).toBe('loopback, linklocal, uniquelocal');
    expect(trustProxy('')).toBe('loopback, linklocal, uniquelocal');
    expect(trustProxy('false')).toBe(false);
    expect(trustProxy('1')).toBe(1);
    expect(trustProxy('10.0.0.2')).toBe('10.0.0.2');
  });
});
