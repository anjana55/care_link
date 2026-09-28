import { requireDatabaseUrl } from './load-env';

describe('requireDatabaseUrl', () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it('returns DATABASE_URL when set', () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
    expect(requireDatabaseUrl()).toBe('mysql://u:p@localhost:3306/db');
  });

  it('throws an actionable error instead of letting mysql2 crash on undefined', () => {
    delete process.env.DATABASE_URL;
    expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL is not set[\s\S]*\.env/);
  });
});
