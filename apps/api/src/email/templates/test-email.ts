/**
 * Sent by Settings > Email's "Send test email" button. Same inline-styled
 * shell as the other emails, so it also shows the admin what real emails will
 * look like in their mail client.
 */
const BRAND = '#2F6B5E';
const INK = '#1F2A24';
const PAPER = '#FBF9F4';
const BORDER = '#E4DFD3';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function testEmail(params: { host: string; port: number; deliveryEnabled: boolean }) {
  const { host, port, deliveryEnabled } = params;
  const subject = 'CareLink test email';
  const status = deliveryEnabled
    ? 'Email delivery is switched on, so verification emails and codes go out through this server.'
    : 'Email delivery is still switched off. Turn it on under Settings > Email when you are ready for real emails to go out.';

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
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${INK};">Your mail server works</h1>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${INK};">This message was sent through ${escapeHtml(host)}:${port} using the settings saved in CareLink.</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7a72;">${status}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Your mail server works

This message was sent through ${host}:${port} using the settings saved in CareLink.

${status}`;

  return { subject, html, text };
}
