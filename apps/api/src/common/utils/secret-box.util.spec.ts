import { decryptSecret, deriveKey, encryptSecret } from './secret-box.util';

describe('secret-box', () => {
  const key = deriveKey('root-secret', 'settings');

  it('round-trips a secret', () => {
    const encrypted = encryptSecret('EAAG-token-123', key);
    expect(encrypted).not.toContain('EAAG-token-123');
    expect(decryptSecret(encrypted, key)).toBe('EAAG-token-123');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('returns null with the wrong key', () => {
    const encrypted = encryptSecret('secret', key);
    expect(decryptSecret(encrypted, deriveKey('other-root', 'settings'))).toBeNull();
  });

  it('returns null when the purpose differs', () => {
    expect(decryptSecret(encryptSecret('secret', key), deriveKey('root-secret', 'otp'))).toBeNull();
  });

  it('returns null for tampered or malformed payloads', () => {
    const [v, iv, tag, ct] = encryptSecret('secret', key).split(':');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    expect(decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'), key)).toBeNull();
    expect(decryptSecret('garbage', key)).toBeNull();
    expect(decryptSecret(null, key)).toBeNull();
    expect(decryptSecret('', key)).toBeNull();
  });
});
