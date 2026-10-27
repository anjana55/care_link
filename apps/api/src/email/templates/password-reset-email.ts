/**
 * The "set a new password" email. Same inline-styled shell as
 * verification-email.ts (see there for why), different words.
 */
import { DEFAULT_EMAIL_BRAND, escapeHtml, type EmailBrand } from './brand';

const INK = '#1F2A24';
const PAPER = '#FBF9F4';
const BORDER = '#E4DFD3';

export interface PasswordResetEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * @param byStaff true when an admin sent the link rather than the person
 * asking for it - the opening line says so, so it isn't a surprise.
 * @param firstPassword true when the account has no password yet (it signs in
 * another way, or was set up by the office) - "set" rather than "reset".
 */
export function passwordResetEmail(params: {
  resetUrl: string;
  name: string;
  expiresIn: string;
  byStaff: boolean;
  firstPassword: boolean;
  brand?: EmailBrand;
}): PasswordResetEmailContent {
  const { resetUrl, name, expiresIn, byStaff, firstPassword, brand = DEFAULT_EMAIL_BRAND } = params;
  const { color: BRAND, colorDark: BRAND_DARK, colorLight: BRAND_LIGHT } = brand;
  const NAME = brand.name;
  const NAME_HTML = escapeHtml(NAME);
  const action = firstPassword ? 'Set your password' : 'Reset your password';
  const subject = `${action} for ${NAME}`;
  const greeting = name ? `Hello ${name},` : 'Hello,';
  const intro = byStaff
    ? `The ${NAME} team has sent you a link to ${firstPassword ? 'set a password' : 'choose a new password'} for your account.`
    : `We received a request to ${firstPassword ? 'set a password' : 'reset the password'} for your ${NAME} account.`;
  const after = 'You can then sign in with your email address and the new password.';
  const ignore = byStaff
    ? `If you weren't expecting this, you can ignore this email - your account stays as it is.`
    : `If you didn't ask for this, you can ignore this email - your password won't change.`;

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
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${INK};">${escapeHtml(action)}</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(intro)} ${escapeHtml(after)}</p>
        </td></tr>
        <tr><td style="padding:8px 28px 28px;" align="center">
          <a href="${resetUrl}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;">${escapeHtml(action)}</a>
        </td></tr>
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${INK};">Or copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;background:${BRAND_LIGHT};color:${BRAND_DARK};padding:10px 12px;border-radius:6px;">${resetUrl}</p>
        </td></tr>
        <tr><td style="padding:0 28px 28px;border-top:1px solid ${BORDER};">
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7a72;">This link works once and expires in ${escapeHtml(expiresIn)}. ${escapeHtml(ignore)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${greeting}

${intro} ${after}

${action} by opening this link:
${resetUrl}

This link works once and expires in ${expiresIn}. ${ignore}`;

  return { subject, html, text };
}
