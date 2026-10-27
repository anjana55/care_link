import { randomInt } from 'crypto';
import type { Request } from 'express';

/** Letters and digits that can't be misread for one another (no 0/O, 1/I/L). */
export const READABLE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(length: number, alphabet = READABLE_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** "OF-7K2Q9M", "WR-…": short enough to read out on the phone. */
export const shortReference = (prefix: string) => `${prefix}-${randomCode(6)}`;

/**
 * The address a request came from, for signature records. nginx sets
 * X-Real-IP itself (overwriting anything the client sent); without nginx in
 * front, the socket address.
 */
export function clientIp(req: Request): string | null {
  const real = req.headers['x-real-ip'];
  const ip = (Array.isArray(real) ? real[0] : real) || req.ip || req.socket?.remoteAddress || null;
  return ip ? ip.slice(0, 45) : null;
}

/** Retries an insert that may collide on a random unique value. */
export async function withUniqueRetry<T>(make: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await make();
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code !== 'ER_DUP_ENTRY' || i >= attempts) throw err;
    }
  }
}
