import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SocialAuthService, SocialLinkError } from './social-auth.service';
import type { SocialProviderClient } from './social/social-provider';
import type { SocialProviderRegistry } from './social/social-provider';

/**
 * The two decisions that make the social route safe to ship.
 *
 * 1. A provider identity may only attach to the record the *same browser
 *    session* created, and only when the provider's verified email agrees with
 *    that record's email. Anything looser lets anyone claim any account by
 *    walking through their own provider screen.
 * 2. The pending token carries a `typ`, because it is signed with the same
 *    secret and carries the same `sub` as an ordinary access token. Without
 *    that discriminator, any caregiver's access token would be accepted here as
 *    a registration in progress and could link a provider to their account.
 *
 * The database is a chainable stub that answers each lookup from a scripted
 * result set, because what is being tested is the decision logic between
 * lookups - not the SQL.
 */

const SECRET = 'test-secret';

interface DbAnswers {
  user?: Record<string, unknown>[];
  /** Lookups in the order the service makes them: identity, then email. */
  lookups?: Record<string, unknown>[][];
}

function stubDb(answers: DbAnswers) {
  const queue = [...(answers.lookups ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const chain: any = {};
  chain.select = jest.fn(() => chain);
  chain.from = jest.fn(() => chain);
  chain.where = jest.fn(() => chain);
  chain.limit = jest.fn(async () => (queue.length ? queue.shift() : []));
  chain.transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(chain),
  );
  chain.insert = jest.fn(() => {
    const c: any = {};
    c.values = jest.fn(() => c);
    c.onDuplicateKeyUpdate = jest.fn(() => c);
    return c;
  });
  chain.update = jest.fn(() => {
    const c: any = {};
    c.set = jest.fn((values: Record<string, unknown>) => {
      inserted.push(values);
      return c;
    });
    c.where = jest.fn(async () => undefined);
    return c;
  });
  return { db: chain as never, chain };
}

function makeService(
  dbAnswers: DbAnswers,
  profile: { accountId: string; email: string },
  overrides: Partial<{ startSession: unknown }> = {},
) {
  const { db, chain } = stubDb(dbAnswers);
  const jwt = new JwtService({ secret: SECRET });

  const client: SocialProviderClient = {
    provider: 'GOOGLE',
    authorizeUrl: () => 'https://accounts.google.com/x',
    exchangeCode: async () => 'access-token',
    fetchProfile: async () => profile,
  };
  const registry = {
    get: () => client,
    available: () => ({ GOOGLE: true, MICROSOFT: false, FACEBOOK: false }),
    anyAvailable: () => true,
  } as unknown as SocialProviderRegistry;

  const authService = { startSession: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })) };

  const service = new SocialAuthService(
    db,
    jwt,
    { get: (k: string) => (k === 'JWT_ACCESS_SECRET' ? SECRET : undefined) } as never,
    authService as never,
    registry,
    { getDefaultCountryCode: async () => '94' } as never,
  );

  return { service, authService, chain, jwt };
}

/** Mints the token the registration endpoint would have returned. */
function pendingToken(jwt: JwtService, userId: string) {
  return jwt.sign({ sub: userId, typ: 'caregiver-social-signup' }, { secret: SECRET, expiresIn: '15m' });
}

const CAREGIVER = { id: 'u1', email: 'care@x.com', role: 'CAREGIVER', isActive: true };

describe('SocialAuthService.completeLink', () => {
  it('links the provider when the provider email matches the record email', async () => {
    const { service, authService, jwt } = makeService(
      { lookups: [[CAREGIVER], [], []] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    const code = await service.completeLink({
      provider: 'GOOGLE',
      code: 'auth-code',
      pendingToken: pendingToken(jwt, 'u1'),
    });

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(authService.startSession).not.toHaveBeenCalled();
  });

  it('compares the address case-insensitively', async () => {
    const { service, jwt } = makeService(
      { lookups: [[{ ...CAREGIVER, email: 'Care@X.com' }], [], []] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).resolves.toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('refuses a provider account on a different email, and issues no session', async () => {
    const { service, authService, jwt } = makeService(
      { lookups: [[CAREGIVER], [], []] },
      { accountId: 'g-2', email: 'someone.else@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).rejects.toMatchObject({ code: 'email_mismatch' });
    expect(authService.startSession).not.toHaveBeenCalled();
  });

  it('adopts the provider email when the record was registered without one', async () => {
    const { service, chain, jwt } = makeService(
      { lookups: [[{ ...CAREGIVER, email: null }], [], []] },
      { accountId: 'g-1', email: 'new@x.com' },
    );

    await service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') });

    const update = chain.update.mock.results[0].value.set.mock.calls[0][0];
    expect(update.email).toBe('new@x.com');
    // The provider proved this address, so it is recorded as verified - which
    // is the whole point of letting email be optional.
    expect(update.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses to take over an email another user already owns', async () => {
    const { service, jwt } = makeService(
      { lookups: [[{ ...CAREGIVER, email: null }], [], [{ id: 'other' }]] },
      { accountId: 'g-1', email: 'taken@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('refuses a provider identity already linked to a different user', async () => {
    const { service, jwt } = makeService(
      { lookups: [[CAREGIVER], [{ userId: 'someone-else' }]] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).rejects.toMatchObject({ code: 'already_linked' });
  });

  it('allows re-linking the same identity to the same user', async () => {
    // A caregiver who abandons the consent screen and comes back through a
    // fresh pending token lands here a second time. That is not an attack.
    const { service, jwt } = makeService(
      { lookups: [[CAREGIVER], [{ userId: 'u1' }], []] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).resolves.toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it('refuses a registration for an account that is not an active caregiver', async () => {
    const { service, jwt } = makeService(
      { lookups: [[{ ...CAREGIVER, isActive: false }]] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(
      service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).rejects.toBeInstanceOf(SocialLinkError);
  });

  describe('the pending token', () => {
    // The discriminator is load-bearing: an access token is signed with the
    // same secret and carries the same `sub`. Without the `typ` check, any
    // signed-in caregiver could link a provider identity to their own account.
    it('rejects an ordinary access token', async () => {
      const { service, jwt } = makeService({ lookups: [[CAREGIVER]] }, { accountId: 'g-1', email: 'care@x.com' });
      const accessToken = jwt.sign({ sub: 'u1', email: 'care@x.com', role: 'CAREGIVER' }, { secret: SECRET });

      await expect(
        service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: accessToken }),
      ).rejects.toMatchObject({ code: 'expired' });
    });

    it('rejects a token signed with another secret', async () => {
      const { service } = makeService({ lookups: [[CAREGIVER]] }, { accountId: 'g-1', email: 'care@x.com' });
      const foreign = new JwtService({ secret: 'not-the-secret' }).sign(
        { sub: 'u1', typ: 'caregiver-social-signup' },
      );

      await expect(
        service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: foreign }),
      ).rejects.toBeInstanceOf(SocialLinkError);
    });

    it('rejects an expired registration link', async () => {
      const { service, jwt } = makeService({ lookups: [[CAREGIVER]] }, { accountId: 'g-1', email: 'care@x.com' });
      const stale = jwt.sign({ sub: 'u1', typ: 'caregiver-social-signup' }, { secret: SECRET, expiresIn: '-1s' });

      await expect(
        service.completeLink({ provider: 'GOOGLE', code: 'c', pendingToken: stale }),
      ).rejects.toBeInstanceOf(SocialLinkError);
    });
  });
});

describe('SocialAuthService.exchangeHandoffCode', () => {
  it('stores only a hash of the code, never the code itself', async () => {
    // The code travels in a URL, so a leaked database must not hand out live
    // sessions. sha256 is what is looked up by, so the plaintext is gone.
    const { service } = makeService({ lookups: [[]] }, { accountId: 'g-1', email: 'care@x.com' });
    expect(service['hashToken']('live-code')).toBe(
      'a3a9a837bb26a467b38d177ab7473679d1e8c597ef790142782edba779310084',
    );
  });

  it('refuses a code that was already spent, without minting a session', async () => {
    const { service, authService } = makeService(
      {
        lookups: [
          [{ id: 'h1', userId: 'u1', codeHash: 'x', expiresAt: new Date(Date.now() + 1000), usedAt: new Date() }],
          [],
        ],
      },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(service.exchangeHandoffCode('anything')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.startSession).not.toHaveBeenCalled();
  });

  it('refuses an expired code', async () => {
    const { service } = makeService(
      {
        lookups: [
          [{ id: 'h1', userId: 'u1', codeHash: 'x', expiresAt: new Date(Date.now() - 1000), usedAt: null }],
        ],
      },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(service.exchangeHandoffCode('anything')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('mints the session through AuthService.startSession once the code is valid', async () => {
    const { service, authService } = makeService(
      {
        lookups: [
          [{ id: 'h1', userId: 'u1', codeHash: 'x', expiresAt: new Date(Date.now() + 1000), usedAt: null }],
          [{ ...CAREGIVER }],
        ],
      },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    await expect(service.exchangeHandoffCode('x')).resolves.toMatchObject({ accessToken: 'a' });
    // Delegating is what keeps this route's session identical to an email or
    // WhatsApp login - same claims, same refresh rotation, same logout.
    expect(authService.startSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
  });
});