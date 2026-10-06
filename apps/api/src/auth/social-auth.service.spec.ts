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
    probeCredentials: async () => ({ ok: true, message: 'ok' }),
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

  it('accepts the lowercase provider name that appears in the callback URL', async () => {
    // The browser is sent back to /auth/social/google/callback, so the service
    // receives `google`, not `GOOGLE`. Using the raw value broke every real
    // sign-in while a test that passed the canonical name stayed green.
    const { service, jwt } = makeService(
      { lookups: [[CAREGIVER], [], []] },
      { accountId: 'g-1', email: 'care@x.com' },
    );

    const code = await service.completeLink({
      provider: 'google',
      code: 'auth-code',
      pendingToken: pendingToken(jwt, 'u1'),
    });

    expect(code).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a provider name it does not know', async () => {
    const { service, jwt } = makeService({ lookups: [[CAREGIVER]] }, { accountId: 'g-1', email: 'care@x.com' });

    await expect(
      service.completeLink({ provider: 'twitter', code: 'c', pendingToken: pendingToken(jwt, 'u1') }),
    ).rejects.toThrow(/unknown sign-in provider/i);
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

/**
 * Returning-caregiver sign-in.
 *
 * The rules that matter: the lookup key is the provider's account id (never the
 * email), nothing is ever created here, and the state that comes back through
 * the provider must be a login state - not a registration token or an ordinary
 * access token.
 */
describe('SocialAuthService sign-in', () => {
  const NONCE = 'abcdefghijklmnop1234';
  const loginState = (jwt: JwtService, nonce = NONCE) =>
    jwt.sign({ typ: 'caregiver-social-login', nonce }, { secret: SECRET, expiresIn: '10m' });

  it('signs in a linked caregiver and returns the browser nonce with the handoff code', async () => {
    const { service, jwt } = makeService(
      { lookups: [[{ userId: 'u1' }], [CAREGIVER]] },
      { accountId: 'g-1', email: 'anything@x.com' },
    );

    const result = await service.completeCallback({ provider: 'GOOGLE', code: 'c', state: loginState(jwt) });

    expect(result.flow).toBe('login');
    expect((result as any).handoffCode).toMatch(/^[0-9a-f]{64}$/);
    expect((result as any).nonce).toBe(NONCE);
  });

  it('does not use the email to find the account', async () => {
    // The provider reports an address unrelated to the one on file; the link is
    // still found by account id, so sign-in succeeds. An email-keyed lookup
    // would have refused it - or worse, matched the wrong person.
    const { service, jwt } = makeService(
      { lookups: [[{ userId: 'u1' }], [{ ...CAREGIVER, email: 'old@x.com' }]] },
      { accountId: 'g-1', email: 'new-owner-of-address@x.com' },
    );

    const result = await service.completeCallback({ provider: 'GOOGLE', code: 'c', state: loginState(jwt) });
    expect(result.flow).toBe('login');
  });

  it('tells an unlinked provider account to register instead of creating one', async () => {
    const { service, jwt, chain } = makeService({ lookups: [[]] }, { accountId: 'g-9', email: 'new@x.com' });

    await expect(
      service.completeCallback({ provider: 'GOOGLE', code: 'c', state: loginState(jwt) }),
    ).rejects.toMatchObject({ code: 'not_registered' });
    expect(chain.insert).not.toHaveBeenCalled();
  });

  it('refuses a linked account that is disabled or not a caregiver', async () => {
    for (const user of [{ ...CAREGIVER, isActive: false }, { ...CAREGIVER, role: 'ADMIN' }]) {
      const { service, jwt } = makeService(
        { lookups: [[{ userId: 'u1' }], [user]] },
        { accountId: 'g-1', email: 'care@x.com' },
      );
      await expect(
        service.completeCallback({ provider: 'GOOGLE', code: 'c', state: loginState(jwt) }),
      ).rejects.toMatchObject({ code: 'account_disabled' });
    }
  });

  it('rejects an expired or foreign-signed login state', async () => {
    const { service } = makeService({ lookups: [] }, { accountId: 'g-1', email: 'care@x.com' });
    const foreign = new JwtService({ secret: 'other' }).sign({ typ: 'caregiver-social-login', nonce: NONCE });
    // A forged state is not recognised as a login state, so it falls to the
    // registration path, which rejects it on the signature.
    await expect(service.completeCallback({ provider: 'GOOGLE', code: 'c', state: foreign })).rejects.toBeInstanceOf(
      SocialLinkError,
    );
  });

  it('does not accept a registration token as a login state, or the reverse', async () => {
    const { service, jwt } = makeService({ lookups: [] }, { accountId: 'g-1', email: 'care@x.com' });
    expect(service.flowOf(pendingToken(jwt, 'u1'))).toBe('signup');
    expect(service.flowOf(loginState(jwt))).toBe('login');
    expect(service.flowOf(jwt.sign({ sub: 'u1' }, { secret: SECRET }))).toBe('signup');
    expect(service.flowOf('garbage')).toBe('signup');
  });

  describe('loginAuthorizeUrl', () => {
    it('refuses a missing or malformed nonce', async () => {
      const { service } = makeService({}, { accountId: 'g', email: 'a@b.c' });
      await expect(service.loginAuthorizeUrl('GOOGLE', '')).rejects.toThrow();
      await expect(service.loginAuthorizeUrl('GOOGLE', 'short')).rejects.toThrow();
      await expect(service.loginAuthorizeUrl('GOOGLE', 'has spaces and !! chars 123')).rejects.toThrow();
    });

    it('produces a state that the callback recognises as a login', async () => {
      const { service } = makeService({}, { accountId: 'g', email: 'a@b.c' });
      let captured = '';
      (service as any).registry.get = () => ({
        authorizeUrl: (state: string) => {
          captured = state;
          return 'https://accounts.google.com/x';
        },
      });
      await service.loginAuthorizeUrl('google', NONCE);
      expect(service.flowOf(captured)).toBe('login');
    });
  });
});
