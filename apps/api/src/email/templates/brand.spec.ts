import { emailBrand } from './brand';
import { notificationEmail } from './notification-email';
import { verificationEmail } from './verification-email';
import { claimCodeEmail } from './claim-code-email';
import { testEmail } from './test-email';
import { withBrand } from '../../common/branding/brand-text';
import { caregiverNotice } from '../../care-requests/notification-messages';
import { invoiceClientNotice } from '../../billing/billing-messages';

/**
 * White-label: every email says the configured company name - in the header,
 * the subject and the text - in the configured colour, and never "CareLink"
 * once the deployment has been renamed. Names are escaped in HTML.
 */
const brand = emailBrand('Golden <Years> & Care', '#1A5FB4');

describe('branded emails', () => {
  const rendered = [
    verificationEmail({ verificationUrl: 'https://x/v?t=1', audience: 'CAREGIVER', expiresInHours: 24, brand }),
    claimCodeEmail({ code: '123456', registrationNumber: 'CG-1', expiresInMinutes: 10, brand }),
    testEmail({ host: 'smtp.x', port: 587, deliveryEnabled: true, brand }),
    notificationEmail({ subject: 'Hello', blocks: [{ lang: 'en', heading: 'Hi', paragraphs: ['Body'] }], brand }),
  ];

  it.each(rendered.map((m, i) => [i, m]))('template %i carries the name and colour, escaped', (_, m) => {
    expect(m.html).toContain('Golden &lt;Years&gt; &amp; Care');
    expect(m.html).not.toContain('Golden <Years>');
    expect(m.html).toContain('#1A5FB4');
    expect(`${m.subject} ${m.html} ${m.text}`).not.toContain('CareLink');
  });

  it('names the brand in the subject and text of the account emails', () => {
    expect(rendered[0].subject).toBe('Verify your Golden <Years> & Care email address');
    expect(rendered[1].text).toContain('Finish setting up your Golden <Years> & Care account');
  });

  it('defaults to the shipped CareLink identity', () => {
    expect(verificationEmail({ verificationUrl: 'u', audience: 'CAREGIVER', expiresInHours: 1 }).subject).toBe('Verify your CareLink email address');
  });
});

describe('notification texts', () => {
  it('keep the {brand} placeholder through their own variable filling, for the sender to fill', () => {
    const invoice = invoiceClientNotice('ISSUED', 'en', { number: 'INV-000001', amount: 'LKR 10.00', date: '2026-10-20' });
    expect(invoice.subject).toBe('Invoice INV-000001 from {brand}');
    expect(withBrand(invoice.body, 'Golden Years')).toContain('your Golden Years account');

    const cg = caregiverNotice('IN_PROGRESS', 'CR-1');
    expect(withBrand(cg.subject, 'Golden Years')).toMatch(/^Golden Years - /);
    expect(withBrand(cg.whatsappText, 'GY')).not.toContain('{brand}');
  });
});
