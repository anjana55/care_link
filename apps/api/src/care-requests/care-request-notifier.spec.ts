import { chooseClientChannel } from './care-request-notifier.service';
import { caregiverNotice, caregiverNoticeFor, clientNotice, clientNoticeFor } from './notification-messages';
import { notificationEmail } from '../email/templates/notification-email';

describe('care request notifications', () => {
  describe('chooseClientChannel', () => {
    it('honours a WhatsApp preference when updates can go out that way', () => {
      expect(chooseClientChannel({ hasEmail: true, canWhatsapp: true, preferred: 'WHATSAPP' })).toBe('WHATSAPP');
    });
    it('falls back to email when WhatsApp updates are off', () => {
      expect(chooseClientChannel({ hasEmail: true, canWhatsapp: false, preferred: 'WHATSAPP' })).toBe('EMAIL');
    });
    it('prefers email for everyone else who has one', () => {
      expect(chooseClientChannel({ hasEmail: true, canWhatsapp: true, preferred: 'PHONE_CALL' })).toBe('EMAIL');
      expect(chooseClientChannel({ hasEmail: true, canWhatsapp: true, preferred: null })).toBe('EMAIL');
    });
    it('uses WhatsApp for a client with no email', () => {
      expect(chooseClientChannel({ hasEmail: false, canWhatsapp: true, preferred: 'PHONE_CALL' })).toBe('WHATSAPP');
    });
    it('sends nothing when there is no usable channel', () => {
      expect(chooseClientChannel({ hasEmail: false, canWhatsapp: false, preferred: 'WHATSAPP' })).toBeNull();
    });
  });

  describe('which moves notify whom', () => {
    it('tells the client about every staff move, but not about their own cancellation', () => {
      expect(clientNoticeFor('IN_PROGRESS')).toBe('IN_PROGRESS');
      expect(clientNoticeFor('INTRODUCED')).toBe('INTRODUCED');
      expect(clientNoticeFor('CLOSED')).toBe('CLOSED');
      expect(clientNoticeFor('CANCELLED')).toBeNull();
      expect(clientNoticeFor('NEW')).toBeNull();
    });
    it('tells the caregiver only when staff pick it up and when they introduce', () => {
      expect(caregiverNoticeFor('IN_PROGRESS')).toBe('IN_PROGRESS');
      expect(caregiverNoticeFor('INTRODUCED')).toBe('INTRODUCED');
      expect(caregiverNoticeFor('CLOSED')).toBeNull();
      expect(caregiverNoticeFor('CANCELLED')).toBeNull();
    });
  });

  describe('wording', () => {
    it('fills the reference in every language and leaves no placeholder behind', () => {
      for (const lang of ['en', 'si', 'ta'] as const) {
        for (const notice of ['RECEIVED', 'IN_PROGRESS', 'INTRODUCED', 'CLOSED'] as const) {
          const t = clientNotice(notice, lang, 'CR-ABC234');
          expect(`${t.subject} ${t.heading} ${t.body}`).not.toMatch(/\{\w+\}/);
          expect(t.body).toContain('CR-ABC234');
        }
      }
    });
    it('writes caregiver notices in all three languages, with a single-line WhatsApp version', () => {
      const n = caregiverNotice('INTRODUCED', 'CR-ABC234');
      expect(n.blocks.map((b) => b.lang)).toEqual(['en', 'si', 'ta']);
      expect(n.whatsappText).not.toMatch(/[\r\n\t]/);
      expect(n.whatsappText.split('CR-ABC234')).toHaveLength(4);
    });
  });

  describe('notificationEmail', () => {
    it('escapes everything it is given', () => {
      const { html } = notificationEmail({
        subject: '<b>x</b>',
        blocks: [{ lang: 'en', heading: 'A & B', paragraphs: ['<script>alert(1)</script>'] }],
        cta: { label: 'Go', url: 'https://example.com/?a=1&b="2"' },
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('A &amp; B');
      expect(html).toContain('&quot;2&quot;');
    });
  });
});
