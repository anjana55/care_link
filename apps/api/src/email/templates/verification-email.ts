/**
 * Plain inline-styled HTML, no external CSS/fonts/images - email clients
 * strip <style> blocks and block remote assets unpredictably, so the only
 * reliable way to brand a transactional email is inline styles on plain
 * tags. Colors are copied from the apps' tailwind.config.js "brand" palette
 * so this looks like the same product, not a generic notification.
 */
const BRAND = '#2F6B5E';
const BRAND_DARK = '#225046';
const BRAND_LIGHT = '#DCEAE6';
const INK = '#1F2A24';
const PAPER = '#FBF9F4';
const BORDER = '#E4DFD3';

export interface VerificationEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * @param audience Which registration flow this is for - just changes the
 * greeting line, since a caregiver and a family/guardian both get an
 * otherwise-identical email.
 */
export function verificationEmail(params: {
  verificationUrl: string;
  audience: 'CAREGIVER' | 'PATIENT_GUARDIAN';
  expiresInHours: number;
}): VerificationEmailContent {
  const { verificationUrl, audience, expiresInHours } = params;
  const intro =
    audience === 'CAREGIVER'
      ? 'Thanks for registering as a caregiver on CareLink.'
      : "Thanks for registering on CareLink to find a caregiver for your family.";

  const subject = 'Verify your CareLink email address';

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">CareLink</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${INK};">Verify your email address</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK};">${intro} Please confirm this is your email address to finish setting up your account.</p>
        </td></tr>
        <tr><td style="padding:8px 28px 28px;" align="center">
          <a href="${verificationUrl}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 28px;border-radius:8px;">Verify email address</a>
        </td></tr>
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${INK};">Or copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;background:${BRAND_LIGHT};color:${BRAND_DARK};padding:10px 12px;border-radius:6px;">${verificationUrl}</p>
        </td></tr>
        <tr><td style="padding:0 28px 28px;border-top:1px solid ${BORDER};">
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#6b7a72;">This link expires in ${expiresInHours} hours. If you didn't create a CareLink account, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${intro}

Verify your email address by opening this link:
${verificationUrl}

This link expires in ${expiresInHours} hours. If you didn't create a CareLink account, you can safely ignore this email.`;

  return { subject, html, text };
}
