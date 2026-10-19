/**
 * The code a caregiver types, with their registration number, to finish an
 * account they registered but never secured. Same inline-styled shell as the
 * verification email (see that file for why), minus the button: this is a code
 * to type on the page they are already on, not a link to follow.
 */
import { DEFAULT_EMAIL_BRAND, escapeHtml, type EmailBrand } from './brand';

const INK = '#1F2A24';
const PAPER = '#FBF9F4';
const BORDER = '#E4DFD3';

export function claimCodeEmail(params: { code: string; registrationNumber: string; expiresInMinutes: number; brand?: EmailBrand }) {
  const { code, registrationNumber, expiresInMinutes, brand = DEFAULT_EMAIL_BRAND } = params;
  const { color: BRAND, colorDark: BRAND_DARK, colorLight: BRAND_LIGHT } = brand;
  const NAME = brand.name;
  const NAME_HTML = escapeHtml(NAME);
  const subject = `Your ${NAME} code: ${code}`;
  const ignore = `If you didn't ask to finish setting up a ${NAME} account, you can ignore this email - nothing changes unless the code is entered.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${NAME_HTML}</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${INK};">Finish setting up your account</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">Enter this code on the ${NAME_HTML} page, together with registration number ${registrationNumber}.</p>
        </td></tr>
        <tr><td style="padding:8px 28px 24px;" align="center">
          <span style="display:inline-block;background:${BRAND_LIGHT};color:${BRAND_DARK};font-size:28px;font-weight:700;letter-spacing:0.2em;padding:12px 24px;border-radius:8px;">${code}</span>
        </td></tr>
        <tr><td style="padding:0 28px 28px;border-top:1px solid ${BORDER};">
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7a72;">The code expires in ${expiresInMinutes} minutes. ${escapeHtml(ignore)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Finish setting up your ${NAME} account

Your code: ${code}
Registration number: ${registrationNumber}

The code expires in ${expiresInMinutes} minutes. ${ignore}`;

  return { subject, html, text };
}
