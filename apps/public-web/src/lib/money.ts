import type { Locale } from '@care-platform/shared';

/** "US$2,500.00" in the reader's format; the code and number if the browser does not know the currency. */
export function formatMoney(amount: string | number, currency: string, locale: Locale | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
