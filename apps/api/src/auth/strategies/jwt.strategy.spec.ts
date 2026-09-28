import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, type JwtPayload } from './jwt.strategy';

function makeDb(row: { id: string; email: string; role: string; isActive: boolean } | undefined) {
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(async () => (row ? [row] : []));
  return chain;
}
const config = { get: () => 'test-secret' } as any;
const payload: JwtPayload = { sub: 'u1', email: 'old@x.com', role: 'ADMIN' };

describe('JwtStrategy.validate', () => {
  it('uses the current role/email from the database, not the token', async () => {
    const s = new JwtStrategy(config, makeDb({ id: 'u1', email: 'new@x.com', role: 'STAFF', isActive: true }));
    await expect(s.validate(payload)).resolves.toMatchObject({ userId: 'u1', email: 'new@x.com', role: 'STAFF' });
  });

  it('rejects a deactivated account even with a valid token', async () => {
    const s = new JwtStrategy(config, makeDb({ id: 'u1', email: 'a@x.com', role: 'ADMIN', isActive: false }));
    await expect(s.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deleted account', async () => {
    const s = new JwtStrategy(config, makeDb(undefined));
    await expect(s.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
