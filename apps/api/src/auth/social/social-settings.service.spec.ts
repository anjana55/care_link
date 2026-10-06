import { ConfigService } from '@nestjs/config';
import { SocialAuthSettingsService, parseSocialProvider } from './social-settings.service';
import { SocialProviderRegistry, GoogleProviderClient, MicrosoftProviderClient, FacebookProviderClient } from './social-provider';
import { encryptSecret, deriveKey } from '../../common/utils/secret-box.util';

/**
 * The admin-managed provider settings.
 *
 * What is under test is the decision logic around the stored rows: a provider is
 * only ever offered when it is switched on AND complete, a secret is stored
 * encrypted and never handed back, and an admin cannot save a configuration that
 * would fail on the first real sign-in.
 */

const ROOT = 'test-root-secret';
const KEY = deriveKey(ROOT, 'social-auth-settings');

type Row = {
  provider: 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';
  enabled: boolean;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  tenant: string | null;
  apiVersion: string | null;
  updatedBy: string | null;
  updatedAt: Date;
};

const row = (over: Partial<Row> & Pick<Row, 'provider'>): Row => ({
  enabled: false,
  clientId: null,
  clientSecretEncrypted: null,
  tenant: null,
  apiVersion: null,
  updatedBy: null,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const empty = () => [row({ provider: 'GOOGLE' }), row({ provider: 'MICROSOFT', tenant: 'common' }), row({ provider: 'FACEBOOK', apiVersion: 'v21.0' })];

function make(rows: Row[], env: Record<string, string> = {}) {
  const store = [...rows];
  const writes: { kind: 'insert' | 'update'; values: any }[] = [];
  const db: any = {
    select: () => ({ from: async () => store.map((r) => ({ ...r })) }),
    insert: () => ({
      values: (v: any) => {
        writes.push({ kind: 'insert', values: v });
        store.push(row({ ...v }));
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
    update: () => ({
      set: (v: any) => ({
        where: async () => {
          writes.push({ kind: 'update', values: v });
          // Single-row updates in these tests always target the provider named in `v`'s context.
          const target = store.find((r) => r.provider === currentTarget);
          if (target) Object.assign(target, v);
        },
      }),
    }),
  };
  let currentTarget = 'GOOGLE';
  const config = {
    get: (k: string) => ({ SETTINGS_ENCRYPTION_KEY: ROOT, PUBLIC_WEB_URL: 'https://carelink.example', ...env })[k],
  } as unknown as ConfigService;
  const service = new SocialAuthSettingsService(db, config);
  return { service, store, writes, target: (p: string) => (currentTarget = p) };
}

describe('parseSocialProvider', () => {
  it('accepts any casing, since it comes from a URL segment', () => {
    expect(parseSocialProvider('google')).toBe('GOOGLE');
    expect(parseSocialProvider('Microsoft')).toBe('MICROSOFT');
    expect(parseSocialProvider('FACEBOOK')).toBe('FACEBOOK');
  });
  it('rejects anything else', () => {
    expect(() => parseSocialProvider('twitter')).toThrow(/unknown sign-in provider/i);
    expect(() => parseSocialProvider('')).toThrow();
    expect(() => parseSocialProvider(undefined)).toThrow();
  });
});

describe('SocialAuthSettingsService', () => {
  it('offers a provider only when it is enabled and has both an id and a secret', async () => {
    const secret = encryptSecret('s3cret', KEY);
    const { service } = make([
      row({ provider: 'GOOGLE', enabled: true, clientId: 'g-id', clientSecretEncrypted: secret }),
      row({ provider: 'MICROSOFT', enabled: true, clientId: 'm-id', clientSecretEncrypted: null }), // no secret
      row({ provider: 'FACEBOOK', enabled: false, clientId: 'f-id', clientSecretEncrypted: secret }), // switched off
    ]);
    const registry = new SocialProviderRegistry(service);

    expect(await registry.available()).toEqual({ GOOGLE: true, MICROSOFT: false, FACEBOOK: false });
    await expect(registry.get('microsoft')).rejects.toThrow(/not available/i);
    await expect(registry.get('facebook')).rejects.toThrow(/not available/i);
    await expect(registry.get('google')).resolves.toBeInstanceOf(GoogleProviderClient);
  });

  it('treats a secret it cannot decrypt as missing instead of offering a broken provider', async () => {
    const wrongKey = encryptSecret('s3cret', deriveKey('another-root', 'social-auth-settings'));
    const { service } = make([row({ provider: 'GOOGLE', enabled: true, clientId: 'g-id', clientSecretEncrypted: wrongKey }), ...empty().slice(1)]);

    expect((await new SocialProviderRegistry(service).available()).GOOGLE).toBe(false);
  });

  it('builds the right client class for each provider', async () => {
    const secret = encryptSecret('s', KEY);
    const { service } = make(
      (['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as const).map((p) => row({ provider: p, enabled: true, clientId: 'id', clientSecretEncrypted: secret, tenant: 'contoso.com', apiVersion: 'v20.0' })),
    );
    const registry = new SocialProviderRegistry(service);
    expect(await registry.get('google')).toBeInstanceOf(GoogleProviderClient);
    expect(await registry.get('microsoft')).toBeInstanceOf(MicrosoftProviderClient);
    expect(await registry.get('facebook')).toBeInstanceOf(FacebookProviderClient);
  });

  describe('first use', () => {
    it('seeds missing rows from the environment so an existing deployment keeps working', async () => {
      const { service, writes } = make([], {
        GOOGLE_CLIENT_ID: 'env-id',
        GOOGLE_CLIENT_SECRET: 'env-secret',
        MICROSOFT_TENANT: 'contoso.com',
      });

      const all = await service.getAllResolved();

      const google = all.find((c) => c.provider === 'GOOGLE')!;
      expect(google.usable).toBe(true);
      expect(google.clientSecret).toBe('env-secret');
      // Complete in the environment -> on; nothing in the environment -> off.
      expect(all.find((c) => c.provider === 'FACEBOOK')!.usable).toBe(false);
      expect(all.find((c) => c.provider === 'MICROSOFT')!.tenant).toBe('contoso.com');
      // The secret was encrypted on the way in.
      const inserted = writes.find((w) => w.kind === 'insert' && w.values.provider === 'GOOGLE')!;
      expect(inserted.values.clientSecretEncrypted).toMatch(/^v1:/);
      expect(inserted.values.clientSecretEncrypted).not.toContain('env-secret');
    });
  });

  describe('what the admin sees', () => {
    it('never returns the secret, only that one is stored and its last four characters', async () => {
      const { service } = make([row({ provider: 'GOOGLE', enabled: true, clientId: 'g', clientSecretEncrypted: encryptSecret('abcd-1234-WXYZ', KEY) }), ...empty().slice(1)]);

      const [google] = await service.getForAdmin();

      expect(google.clientSecretSet).toBe(true);
      expect(google.clientSecretHint).toBe('••••WXYZ');
      expect(JSON.stringify(google)).not.toContain('abcd-1234');
      expect(JSON.stringify(google)).not.toContain('v1:');
    });

    it('shows the exact callback URL to register, in lowercase', async () => {
      const { service } = make(empty());
      const list = await service.getForAdmin();
      expect(list.map((s) => s.redirectUri)).toEqual([
        'https://carelink.example/api/auth/social/google/callback',
        'https://carelink.example/api/auth/social/microsoft/callback',
        'https://carelink.example/api/auth/social/facebook/callback',
      ]);
    });

    it('honours SOCIAL_AUTH_CALLBACK_BASE_URL', async () => {
      const { service } = make(empty(), { SOCIAL_AUTH_CALLBACK_BASE_URL: 'https://api.carelink.example/' });
      expect(service.redirectUri('GOOGLE')).toBe('https://api.carelink.example/auth/social/google/callback');
    });
  });

  describe('update', () => {
    it('stores the secret encrypted and returns it only as a hint', async () => {
      const { service, writes, target } = make(empty());
      target('GOOGLE');

      const saved = await service.update('GOOGLE', { enabled: true, clientId: ' g-id ', clientSecret: 'topsecretvalue' }, 'admin-1');

      const patch = writes.find((w) => w.kind === 'update')!.values;
      expect(patch.clientSecretEncrypted).toMatch(/^v1:/);
      expect(patch.clientSecretEncrypted).not.toContain('topsecretvalue');
      expect(patch.clientId).toBe('g-id'); // trimmed
      expect(patch.updatedBy).toBe('admin-1');
      expect(saved.usable).toBe(true);
      expect(saved.clientSecretHint).toBe('••••alue');
      expect(JSON.stringify(saved)).not.toContain('topsecretvalue');
    });

    it('refuses to enable a provider without a client ID or secret', async () => {
      const { service } = make(empty());
      await expect(service.update('GOOGLE', { enabled: true }, 'a')).rejects.toThrow(/client ID, client secret/);
      await expect(service.update('GOOGLE', { enabled: true, clientId: 'x' }, 'a')).rejects.toThrow(/client secret/);
      await expect(service.update('GOOGLE', { enabled: true, clientSecret: 'x' }, 'a')).rejects.toThrow(/client ID/);
    });

    it('keeps the stored secret when only other fields change', async () => {
      const secret = encryptSecret('keep-me', KEY);
      const { service, writes, target } = make([row({ provider: 'GOOGLE', enabled: true, clientId: 'g', clientSecretEncrypted: secret }), ...empty().slice(1)]);
      target('GOOGLE');

      await service.update('GOOGLE', { enabled: false }, 'a');

      expect(writes.find((w) => w.kind === 'update')!.values).not.toHaveProperty('clientSecretEncrypted');
    });

    it('makes the admin re-enter the secret when the client ID changes', async () => {
      const { service } = make([row({ provider: 'GOOGLE', enabled: true, clientId: 'old', clientSecretEncrypted: encryptSecret('s', KEY) }), ...empty().slice(1)]);

      await expect(service.update('GOOGLE', { clientId: 'new' }, 'a')).rejects.toThrow(/secret again/i);
      await expect(service.update('GOOGLE', { clientId: 'new', clientSecret: 'fresh' }, 'a')).resolves.toBeDefined();
    });

    it('removes the secret on request, and then cannot stay enabled', async () => {
      const { service } = make([row({ provider: 'GOOGLE', enabled: true, clientId: 'g', clientSecretEncrypted: encryptSecret('s', KEY) }), ...empty().slice(1)]);

      await expect(service.update('GOOGLE', { clearClientSecret: true }, 'a')).rejects.toThrow(/client secret/);
      await expect(service.update('GOOGLE', { clearClientSecret: true, enabled: false }, 'a')).resolves.toMatchObject({ clientSecretSet: false, enabled: false });
    });

    it('only applies tenant to Microsoft and API version to Facebook', async () => {
      const { service, writes, target } = make(empty());
      target('GOOGLE');
      await service.update('GOOGLE', { tenant: 'contoso.com', apiVersion: 'v19.0' }, 'a');
      const g = writes.filter((w) => w.kind === 'update').pop()!.values;
      expect(g.tenant).toBeNull();
      expect(g.apiVersion).toBeNull();

      target('MICROSOFT');
      await service.update('MICROSOFT', { tenant: 'contoso.com' }, 'a');
      expect(writes.filter((w) => w.kind === 'update').pop()!.values.tenant).toBe('contoso.com');
    });

    it('refuses an http callback URL in production', async () => {
      const { service } = make(empty(), { NODE_ENV: 'production', PUBLIC_WEB_URL: 'http://carelink.example' });
      await expect(service.update('GOOGLE', { enabled: true, clientId: 'g', clientSecret: 's' }, 'a')).rejects.toThrow(/https/);
    });
  });
});

describe('credential probes', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const answer = (status: number, body: unknown) => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  };
  const cfg = (provider: 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK') => ({
    provider, enabled: true, clientId: 'id', clientSecret: 'secret', tenant: 'common', apiVersion: 'v21.0', usable: true,
  });
  const probe = (p: 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK') => SocialProviderRegistry.build(cfg(p)).probeCredentials('https://x/cb');

  it('Google: invalid_grant means the client was accepted, invalid_client means it was not', async () => {
    answer(400, { error: 'invalid_grant', error_description: 'Malformed auth code.' });
    expect((await probe('GOOGLE')).ok).toBe(true);
    answer(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
    const bad = await probe('GOOGLE');
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/client ID or secret/);
  });

  it('Microsoft: tells a wrong secret from an unknown application', async () => {
    answer(401, { error: 'invalid_client', error_codes: [7000215] });
    expect((await probe('MICROSOFT')).message).toMatch(/client secret/);
    answer(400, { error: 'unauthorized_client', error_codes: [700016] });
    expect((await probe('MICROSOFT')).message).toMatch(/application \(client\) ID/);
    answer(400, { error: 'invalid_grant', error_codes: [70000] });
    expect((await probe('MICROSOFT')).ok).toBe(true);
  });

  it('Facebook: tells a wrong secret from a wrong app ID', async () => {
    answer(400, { error: { message: 'Error validating client secret.', code: 1 } });
    expect((await probe('FACEBOOK')).message).toMatch(/app secret/);
    answer(400, { error: { message: 'Invalid app ID', code: 101 } });
    expect((await probe('FACEBOOK')).message).toMatch(/app ID/);
    answer(400, { error: { message: 'Invalid verification code format.', code: 100 } });
    expect((await probe('FACEBOOK')).ok).toBe(true);
  });

  it('never repeats the provider\'s own wording, which can quote the secret', async () => {
    answer(401, { error: 'invalid_client', error_description: 'secret=secret is wrong' });
    const r = await probe('GOOGLE');
    expect(JSON.stringify(r)).not.toContain('secret=secret');
  });

  it('reports an unreachable provider instead of throwing', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as never;
    const r = await probe('GOOGLE');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/could not reach/i);
  });
});
