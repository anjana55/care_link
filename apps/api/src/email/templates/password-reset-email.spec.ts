import { passwordResetEmail } from './password-reset-email';

describe('passwordResetEmail', () => {
  const base = { resetUrl: 'https://example.lk/reset-password?token=abc', name: 'Amal <script>', expiresIn: '1 hour' };

  it('asks to reset an existing password, and says who asked', () => {
    const mail = passwordResetEmail({ ...base, byStaff: false, firstPassword: false });
    expect(mail.subject).toMatch(/^Reset your password/);
    expect(mail.text).toContain('We received a request to reset the password');
    expect(mail.text).toContain(base.resetUrl);
    expect(mail.text).toContain('expires in 1 hour');
    expect(mail.html).toContain('Amal &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
  });

  it('says "set" for an account without a password, and names the team when staff sent it', () => {
    const mail = passwordResetEmail({ ...base, byStaff: true, firstPassword: true, expiresIn: '24 hours' });
    expect(mail.subject).toMatch(/^Set your password/);
    expect(mail.text).toContain('team has sent you a link to set a password');
    expect(mail.text).toContain("If you weren't expecting this");
  });
});
