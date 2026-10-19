/**
 * A plain transactional notice: one or more blocks of text and an optional
 * button. Same inline-styled shell as the verification email (see that file
 * for why it is all inline styles and tables).
 *
 * Several blocks let one email carry the same notice in English, Sinhala and
 * Tamil, for recipients whose language the platform does not know.
 */
import { DEFAULT_EMAIL_BRAND, escapeHtml, type EmailBrand } from './brand';

const INK = '#1F2A24';
const PAPER = '#FBF9F4';
const BORDER = '#E4DFD3';
const MUTED = '#6b7a72';

export interface NotificationBlock {
  /** BCP-47 tag for the block, so mail clients and screen readers pick the right voice and font. */
  lang: 'en' | 'si' | 'ta';
  heading: string;
  paragraphs: string[];
}

export interface NotificationEmailParams {
  subject: string;
  blocks: NotificationBlock[];
  cta?: { label: string; url: string };
  footer?: string;
  brand?: EmailBrand;
}

export function notificationEmail(params: NotificationEmailParams) {
  const { subject, blocks, cta, footer, brand = DEFAULT_EMAIL_BRAND } = params;
  const BRAND = brand.color;
  const NAME_HTML = escapeHtml(brand.name);
  const htmlLang = blocks.length === 1 ? blocks[0].lang : 'en';

  const blockHtml = blocks
    .map(
      (block, i) => `
        <tr><td lang="${block.lang}" style="padding:${i === 0 ? '28px' : '20px'} 28px 4px;${i > 0 ? `border-top:1px solid ${BORDER};` : ''}">
          <h1 style="margin:0 0 12px;font-size:${i === 0 ? '20px' : '17px'};line-height:1.35;color:${INK};">${escapeHtml(block.heading)}</h1>
          ${block.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(p)}</p>`).join('')}
        </td></tr>`,
    )
    .join('');

  const ctaHtml = cta
    ? `
        <tr><td style="padding:8px 28px 24px;" align="left">
          <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(cta.label)}</a>
        </td></tr>`
    : '';

  const footerHtml = footer
    ? `
        <tr><td style="padding:0 28px 24px;border-top:1px solid ${BORDER};">
          <p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">${escapeHtml(footer)}</p>
        </td></tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${htmlLang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:Arial,Helvetica,'Noto Sans Sinhala','Noto Sans Tamil',sans-serif;color:${INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">${NAME_HTML}</span>
        </td></tr>${blockHtml}${ctaHtml}${footerHtml}
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    ...blocks.map((b) => [b.heading, '', ...b.paragraphs].join('\n')),
    ...(cta ? [`${cta.label}: ${cta.url}`] : []),
    ...(footer ? [footer] : []),
  ].join('\n\n');

  return { subject, html, text };
}
