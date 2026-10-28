import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { EmailSettingsService, type ResolvedEmailSettings } from './email-settings.service';
import { passwordResetEmail } from './templates/password-reset-email';
import { verificationEmail } from './templates/verification-email';
import { claimCodeEmail } from './templates/claim-code-email';
import { testEmail } from './templates/test-email';
import { notificationEmail, type NotificationEmailParams } from './templates/notification-email';
import { DEFAULT_EMAIL_BRAND, emailBrand, type EmailBrand } from './templates/brand';
import { BrandingSettingsService } from '../branding/branding-settings.service';
import { withBrand } from '../common/branding/brand-text';

const VERIFICATION_TOKEN_TTL_HOURS = 24; // must match AuthService's VERIFICATION_TOKEN_TTL_MS

/**
 * Bounds on every SMTP conversation. nodemailer's own defaults wait up to two
 * minutes to connect, which turns a firewalled port into a "Send test" button
 * that just spins. A real server answers well inside these.
 */
const SMTP_TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

interface Message {
  subject: string;
  html: string;
  text: string;
}

/**
 * Real SMTP delivery for transactional email. Works with any SMTP provider
 * (a self-hosted Postfix relay, Amazon SES's SMTP interface, SendGrid,
 * Mailgun, Gmail, ...) rather than locking this self-hosted app into one
 * vendor's SDK.
 *
 * The server is configured by an admin under Settings > Email
 * (EmailSettingsService), and read on every send - so a change applies
 * immediately, with no restart. While delivery is off or incomplete, emails
 * are logged to the console instead, so the rest of the app keeps working and
 * registration/verification stays testable without a mailbox.
 */
@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  /** The pooled transporter for the current settings, rebuilt when they change. */
  private pooled: { key: string; transporter: Transporter } | null = null;

  constructor(
    private readonly settings: EmailSettingsService,
    @Optional() private readonly branding?: BrandingSettingsService,
  ) {}

  /** The company name and colour from Settings > Branding. Never throws: an email is not worth failing over its header. */
  private async brand(): Promise<EmailBrand> {
    try {
      if (!this.branding) return DEFAULT_EMAIL_BRAND;
      const b = await this.branding.getPublic();
      return emailBrand(b.companyName, b.primaryColor);
    } catch {
      return DEFAULT_EMAIL_BRAND;
    }
  }

  /**
   * Reports the mail setup at boot, without ever holding boot up: on a fresh
   * deploy the API starts before migrations have created the settings table,
   * and an unreachable SMTP server must not delay or crash startup either.
   */
  onModuleInit() {
    void this.reportStatus().catch(() => {
      // Table not there yet (pre-migration) or the database is still coming
      // up - the first real send reads the settings again anyway.
    });
  }

  onModuleDestroy() {
    this.pooled?.transporter.close();
    this.pooled = null;
  }

  private async reportStatus() {
    const s = await this.settings.getResolved();
    if (!s.usable) {
      this.logger.warn(
        'Email delivery is not set up - verification emails will be written to this log instead of sent. ' +
          'An admin can configure the mail server under Settings > Email.',
      );
      return;
    }
    try {
      await this.transporterFor(s).verify();
      this.logger.log(`SMTP connection verified (${s.host}:${s.port}) - email delivery is live.`);
    } catch (err) {
      this.logger.error(`SMTP connection check failed - emails will fail to send until this is fixed: ${(err as Error).message}`);
    }
  }

  private static key(s: ResolvedEmailSettings) {
    return JSON.stringify([s.host, s.port, s.secure, s.username, s.password]);
  }

  private static transportOptions(s: ResolvedEmailSettings) {
    return {
      host: s.host!,
      port: s.port,
      secure: s.secure,
      // Only some relays require auth - an internal unauthenticated relay
      // is a legitimate setup, so this stays undefined rather than sending
      // an empty {user: '', pass: ''} that some servers reject outright.
      auth: s.username && s.password ? { user: s.username, pass: s.password } : undefined,
      ...SMTP_TIMEOUTS,
    };
  }

  /** The pooled transporter for these settings, replacing (and closing) a stale one. */
  private transporterFor(s: ResolvedEmailSettings): Transporter {
    const key = EmailService.key(s);
    if (this.pooled?.key === key) return this.pooled.transporter;
    this.pooled?.transporter.close();
    const transporter = nodemailer.createTransport({ ...EmailService.transportOptions(s), pool: true });
    this.pooled = { key, transporter };
    return transporter;
  }

  private static from(s: ResolvedEmailSettings, brand: EmailBrand) {
    return { name: s.fromName || brand.name, address: s.fromAddress! };
  }

  /**
   * Delivers one message, or logs it when delivery isn't set up. Never throws:
   * the callers fire-and-forget (see sendVerificationEmail).
   */
  private async deliver(to: string, message: Message, label: string, consoleLine: string): Promise<void> {
    let s: ResolvedEmailSettings;
    try {
      s = await this.settings.getResolved();
    } catch (err) {
      this.logger.error(`Couldn't read the email settings, so the ${label} for ${to} was not sent: ${(err as Error).message}`);
      this.logger.log(`[EMAIL NOT SENT] ${consoleLine}`);
      return;
    }

    if (!s.usable) {
      this.logger.log(`[EMAIL NOT CONFIGURED] ${consoleLine}`);
      return;
    }

    try {
      await this.transporterFor(s).sendMail({ from: EmailService.from(s, await this.brand()), replyTo: s.replyTo || undefined, to, ...message });
      this.logger.log(`${label[0].toUpperCase()}${label.slice(1)} sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send ${label} to ${to}: ${(err as Error).message}`);
    }
  }

  /**
   * Fire-and-forget by design: called without `await` from AuthService so a
   * slow/unreachable SMTP server never delays the registration response.
   * Failures are logged here, not thrown - the account already exists, and
   * /auth/resend-verification is the recovery path if the email never
   * arrives, so a delivery failure must not surface as a registration error.
   */
  async sendVerificationEmail(to: string, verificationUrl: string, audience: 'CAREGIVER' | 'PATIENT_GUARDIAN' | 'EMPLOYER'): Promise<void> {
    const message = verificationEmail({ verificationUrl, audience, expiresInHours: VERIFICATION_TOKEN_TTL_HOURS, brand: await this.brand() });
    await this.deliver(to, message, 'verification email', `Verification link for ${to}: ${verificationUrl}`);
  }

  /** A one-time link to set a new password (PasswordResetService). Never throws, like the others. */
  async sendPasswordResetEmail(to: string, params: { resetUrl: string; name: string; expiresIn: string; byStaff: boolean; firstPassword: boolean }): Promise<void> {
    const message = passwordResetEmail({ ...params, brand: await this.brand() });
    await this.deliver(to, message, 'password reset email', `Password reset link for ${to}: ${params.resetUrl}`);
  }

  /** The six-digit code for finishing an unsecured caregiver account (AccountClaimService). */
  async sendClaimCodeEmail(to: string, code: string, registrationNumber: string, expiresInMinutes: number): Promise<void> {
    const message = claimCodeEmail({ code, registrationNumber, expiresInMinutes, brand: await this.brand() });
    await this.deliver(to, message, 'claim code email', `Claim code for ${to} (${registrationNumber}): ${code}`);
  }

  /**
   * A notice about a care request (see CareRequestNotifier). Fire-and-forget
   * like the senders above: never throws, logs instead.
   */
  async sendNotificationEmail(to: string | string[], params: NotificationEmailParams, label: string): Promise<void> {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return;
    const brand = await this.brand();
    // Message texts name the company as {brand}; see common/branding/brand-text.ts.
    const b = (text: string) => withBrand(text, brand.name);
    const message = notificationEmail({
      subject: b(params.subject),
      blocks: params.blocks.map((block) => ({ ...block, heading: b(block.heading), paragraphs: block.paragraphs.map(b) })),
      cta: params.cta && { ...params.cta, label: b(params.cta.label) },
      footer: params.footer && b(params.footer),
      brand,
    });
    await this.deliver(recipients.join(', '), message, label, `${message.subject} -> ${recipients.join(', ')}`);
  }

  /**
   * Settings > Email's "Send test email". Unlike the senders above this one
   * THROWS, with the server's own reason, because explaining a failure is the
   * whole point of the button. It uses the saved settings even while delivery
   * is switched off, so an admin can prove a server works before turning it on,
   * and a fresh, unpooled connection so the result reflects the server now.
   */
  async sendTestEmail(to: string): Promise<{ accepted: boolean; response: string }> {
    const s = await this.settings.getResolved();
    if (!s.host) throw new Error('Save a server host first.');
    if (!s.fromAddress) throw new Error('Save a sender address first.');
    if (s.username && !s.password) throw new Error('A username is saved without a password - enter the password and save.');

    const brand = await this.brand();
    const transporter = nodemailer.createTransport(EmailService.transportOptions(s));
    try {
      const info = await transporter.sendMail({
        from: EmailService.from(s, brand),
        replyTo: s.replyTo || undefined,
        to,
        ...testEmail({ host: s.host, port: s.port, deliveryEnabled: s.usable, brand }),
      });
      return { accepted: info.accepted.length > 0, response: String(info.response ?? '') };
    } finally {
      transporter.close();
    }
  }
}
