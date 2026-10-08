import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { verificationEmail } from './templates/verification-email';
import { claimCodeEmail } from './templates/claim-code-email';

const VERIFICATION_TOKEN_TTL_HOURS = 24; // must match AuthService's VERIFICATION_TOKEN_TTL_MS

/**
 * Real SMTP delivery for transactional email. Works with any SMTP provider
 * (a self-hosted Postfix relay, Amazon SES's SMTP interface, SendGrid,
 * Mailgun, Gmail, ...) rather than locking this self-hosted app into one
 * vendor's SDK.
 *
 * When SMTP_HOST isn't set (local dev, or a prod deploy that hasn't
 * configured email yet), falls back to logging the email to the console -
 * the same behavior the old sendVerificationEmailStub had - so the rest of
 * the app keeps working and registration/verification stays testable
 * without a mailbox. See DEPLOYMENT.md's "Email (SMTP)" section.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.from = this.config.get<string>('SMTP_FROM') || 'CareLink <no-reply@care-platform.local>';

    if (host) {
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASSWORD');
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT') ?? 587,
        secure: this.config.get<string>('SMTP_SECURE') === 'true',
        // Only some relays require auth - an internal unauthenticated relay
        // is a legitimate setup, so this stays undefined rather than sending
        // an empty {user: '', pass: ''} that some servers reject outright.
        auth: user && pass ? { user, pass } : undefined,
        pool: true,
      });
    }
  }

  async onModuleInit() {
    if (!this.transporter) {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        this.logger.error(
          'SMTP_HOST is not set - verification emails will be logged to the console instead of delivered. ' +
            'Set SMTP_HOST/SMTP_FROM (and restart) once you have real SMTP credentials - see DEPLOYMENT.md.',
        );
      } else {
        this.logger.warn('SMTP_HOST is not set - verification emails will be logged to the console instead of sent.');
      }
      return;
    }
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP connection verified (${this.config.get<string>('SMTP_HOST')}) - email delivery is live.`);
    } catch (err) {
      this.logger.error(`SMTP connection check failed - emails will fail to send until this is fixed: ${(err as Error).message}`);
    }
  }

  /**
   * Fire-and-forget by design: called without `await` from AuthService so a
   * slow/unreachable SMTP server never delays the registration response.
   * Failures are logged here, not thrown - the account already exists, and
   * /auth/resend-verification is the recovery path if the email never
   * arrives, so a delivery failure must not surface as a registration error.
   */
  async sendVerificationEmail(to: string, verificationUrl: string, audience: 'CAREGIVER' | 'PATIENT_GUARDIAN'): Promise<void> {
    const { subject, html, text } = verificationEmail({
      verificationUrl,
      audience,
      expiresInHours: VERIFICATION_TOKEN_TTL_HOURS,
    });

    if (!this.transporter) {
      this.logger.log(`[EMAIL NOT CONFIGURED] Verification link for ${to}: ${verificationUrl}`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text });
      this.logger.log(`Verification email sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send verification email to ${to}: ${(err as Error).message}`);
    }
  }

  /** The six-digit code for finishing an unsecured caregiver account (AccountClaimService). */
  async sendClaimCodeEmail(to: string, code: string, registrationNumber: string, expiresInMinutes: number): Promise<void> {
    const { subject, html, text } = claimCodeEmail({ code, registrationNumber, expiresInMinutes });

    if (!this.transporter) {
      this.logger.log(`[EMAIL NOT CONFIGURED] Claim code for ${to} (${registrationNumber}): ${code}`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text });
      this.logger.log(`Claim code email sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send claim code email to ${to}: ${(err as Error).message}`);
    }
  }
}
