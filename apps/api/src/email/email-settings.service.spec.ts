import { BadRequestException } from '@nestjs/common';
import { EmailSettingsService, parseFromHeader } from './email-settings.service';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';

/**
 * The admin-managed mail server settings (Settings > Email).
 *
 * Under test: the first-use seed from SMTP_* keeps an existing deployment
 * delivering, the password is stored encrypted and never handed back, and an
 * admin cannot save a configuration that would fail on the first real email.
 */

const ROOT = 'test-root-secret';
const KEY = deriveKey(ROOT, 'email-settings');

function make(env: Record<string, string | undefined> = {}, initial?: Record<string, unknown>) {
  let row: Record<string, unknown> | null = initial
    ? {
        id: 'default',
        enabled: false,
        host: null,
        port: 587,
        secure: false,
        username: null,
        passwordEncrypted: null,
        fromName: 'CareLink',
        fromAddress: null,
        replyTo: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...initial,
      }
    : null;
  const query = { where: () => ({ limit: async () => (row ? [{ ...row }] : []) }) };
  const db: any = {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        row = { replyTo: null, updatedBy: null, createdAt: new Date(), updatedAt: new Date(), ...v };
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void Object.assign(row!, v) }) }),
  };
  const config: any = { get: (k: string) => ({ SETTINGS_ENCRYPTION_KEY: ROOT, ...env })[k] };
  return { service: new EmailSettingsService(db, config), stored: () => row! };
}

describe('parseFromHeader', () => {
  it.each([
    ['CareLink <no-reply@x.com>', 'CareLink', 'no-reply@x.com'],
    ['"Care Link" <a@b.lk>', 'Care Link', 'a@b.lk'],
    ['a@b.lk', null, 'a@b.lk'],
    ['', null, null],
    ['not an address', null, null],
  ])('%s', (raw, name, address) => {
    expect(parseFromHeader(raw)).toEqual({ name, address });
  });
});

describe('EmailSettingsService', () => {
  it('seeds from SMTP_* on first use and keeps an already-configured server delivering', async () => {
    const { service, stored } = make({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'p@ss word',
      SMTP_FROM: 'CareLink <no-reply@example.com>',
    });
    const s = await service.getResolved();
    expect(s).toMatchObject({ enabled: true, usable: true, host: 'smtp.example.com', port: 465, secure: true, username: 'mailer', password: 'p@ss word', fromName: 'CareLink', fromAddress: 'no-reply@example.com' });
    // Stored encrypted, not in plain text.
    expect(stored().passwordEncrypted).not.toContain('p@ss');
    expect(decryptSecret(stored().passwordEncrypted as string, KEY)).toBe('p@ss word');
  });

  it('starts switched off when the environment has no server', async () => {
    const { service } = make({});
    expect(await service.getResolved()).toMatchObject({ enabled: false, usable: false, host: null, port: 587 });
  });

  it('never returns the password to the admin UI', async () => {
    const { service } = make({}, { host: 'h', username: 'u', passwordEncrypted: encryptSecret('secret', KEY) });
    const admin = await service.getForAdmin();
    expect(admin.passwordSet).toBe(true);
    expect(JSON.stringify(admin)).not.toContain('secret');
    expect(admin).not.toHaveProperty('passwordEncrypted');
  });

  it('refuses to switch delivery on with half a setup', async () => {
    const { service } = make({});
    await expect(service.update({ enabled: true, host: 'smtp.example.com' }, 'admin')).rejects.toThrow(/sender address/);
    await expect(service.update({ enabled: true, host: 'smtp.example.com', fromAddress: 'a@b.lk', username: 'u' }, 'admin')).rejects.toThrow(/password/);
  });

  it('saves a complete setup and keeps the stored password when none is typed', async () => {
    const { service, stored } = make({});
    await service.update({ enabled: true, host: 'smtp.example.com', fromAddress: 'a@b.lk', username: 'u', password: 'pw' }, 'admin');
    const first = stored().passwordEncrypted;
    const after = await service.update({ port: 2525 }, 'admin');
    expect(after).toMatchObject({ enabled: true, usable: true, port: 2525, passwordSet: true });
    expect(stored().passwordEncrypted).toBe(first);
  });

  it('asks for the password again when the username changes', async () => {
    const { service } = make({}, { host: 'h', fromAddress: 'a@b.lk', username: 'u', passwordEncrypted: encryptSecret('pw', KEY) });
    await expect(service.update({ username: 'someone-else' }, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops the password when the username is cleared (unauthenticated relay)', async () => {
    const { service, stored } = make({}, { enabled: true, host: 'h', fromAddress: 'a@b.lk', username: 'u', passwordEncrypted: encryptSecret('pw', KEY) });
    const after = await service.update({ username: '' }, 'admin');
    expect(after).toMatchObject({ username: null, passwordSet: false, usable: true });
    expect(stored().passwordEncrypted).toBeNull();
  });
});
