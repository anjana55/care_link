import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

/**
 * Small AES-256-GCM helper for secrets that must be recoverable (the WhatsApp
 * access token has to be sent to Meta, so unlike passwords it can't be
 * hashed). Format: "v1:<iv>:<tag>:<ciphertext>", all base64.
 *
 * Keys are derived per purpose from a root secret, so the OTP-hashing key,
 * the settings-encryption key and the JWT secrets never coincide even when
 * they ultimately come from the same environment variable.
 */
const VERSION = 'v1';

export function deriveKey(rootSecret: string, purpose: string): Buffer {
  return createHmac('sha256', rootSecret).update(`care-platform:${purpose}`).digest();
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Returns null (never throws) when the value is malformed or the key is wrong. */
export function decryptSecret(payload: string | null | undefined, key: Buffer): string | null {
  if (!payload) return null;
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
