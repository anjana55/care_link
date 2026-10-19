import { DEFAULT_COMPANY_NAME, DEFAULT_PRIMARY_COLOR, derivePalette } from '@care-platform/shared';

/**
 * Who an email is from, as painted in its header and button: the company name
 * and brand colours from Settings > Branding. Email clients strip stylesheets
 * and block remote images, so the logo is not embedded - the name in the
 * brand colour is what reliably survives every inbox.
 */
export interface EmailBrand {
  name: string;
  color: string;
  colorDark: string;
  colorLight: string;
}

export function emailBrand(name: string = DEFAULT_COMPANY_NAME, primaryColor: string = DEFAULT_PRIMARY_COLOR): EmailBrand {
  const p = derivePalette(primaryColor, primaryColor);
  return { name, color: p.brand, colorDark: p.brandDark, colorLight: p.brandLight };
}

export const DEFAULT_EMAIL_BRAND: EmailBrand = emailBrand();

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
