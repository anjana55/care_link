import { createHash, timingSafeEqual } from 'crypto';

/**
 * PayHere's Checkout API, reduced to the two calculations that must be exact.
 * https://support.payhere.lk/api-&-mobile-sdk/checkout-api
 *
 * - The checkout form carries a hash so the amount cannot be changed in the
 *   browser: UPPER(MD5(merchant_id + order_id + amount + currency + UPPER(MD5(secret)))).
 *   It is made here, on the server - the secret never reaches the browser.
 * - PayHere then POSTs the outcome to our notify URL (form-encoded) with an
 *   md5sig made the same way from what it reports. Only a notification whose
 *   signature checks out is believed, and only status 2 means "paid".
 *
 * Amounts are always written with two decimals and no thousands separator.
 */

export const PAYHERE_URLS = {
  SANDBOX: 'https://sandbox.payhere.lk/pay/checkout',
  // The www is required - without it PayHere answers PH-0022.
  LIVE: 'https://www.payhere.lk/pay/checkout',
} as const;

export const PAYHERE_STATUS = { SUCCESS: '2', PENDING: '0', CANCELLED: '-1', FAILED: '-2', CHARGEDBACK: '-3' } as const;

const md5Upper = (s: string) => createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();

export function checkoutHash(merchantId: string, orderId: string, amount: string, currency: string, secret: string): string {
  return md5Upper(`${merchantId}${orderId}${amount}${currency}${md5Upper(secret)}`);
}

export interface PayhereNotification {
  merchant_id?: string;
  order_id?: string;
  payment_id?: string;
  payhere_amount?: string;
  payhere_currency?: string;
  status_code?: string;
  md5sig?: string;
  status_message?: string;
  method?: string;
}

/** True only when md5sig is what our secret produces for exactly these values. */
export function verifyNotification(n: PayhereNotification, merchantId: string, secret: string): boolean {
  if (!n.md5sig || !n.order_id || !n.payhere_amount || !n.payhere_currency || n.status_code === undefined) return false;
  if (n.merchant_id !== merchantId) return false;
  const expected = md5Upper(`${merchantId}${n.order_id}${n.payhere_amount}${n.payhere_currency}${n.status_code}${md5Upper(secret)}`);
  const got = n.md5sig.trim().toUpperCase();
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** PayHere wants a first and a last name; we keep one full name. */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? 'Client', last: parts[0] ?? 'Client' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * PayHere rejects some characters outright ("Something went wrong"): emoji,
 * markup. Its form fields get plain text, trimmed to a sane length.
 */
export function payhereText(s: string | null | undefined, max = 100): string {
  return (s ?? '')
    .replace(/[<>"`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{P}\p{Zs}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
