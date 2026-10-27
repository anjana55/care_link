import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';

interface Notice {
  subject: string;
  heading?: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
}

/**
 * Emails on the international paths: alerts to staff, and notices to
 * employers and caregivers. Best-effort by design - a failed email is
 * logged, never thrown, so it can never undo the change it is about.
 *
 * Employer emails are English only: the employer side of the site is aimed
 * at organisations abroad. Caregiver notices are kept short and point back
 * to the caregiver's own area, where they read in the caregiver's language.
 */
@Injectable()
export class InternationalNotifier {
  private readonly logger = new Logger(InternationalNotifier.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly config: ConfigService,
  ) {}

  async toStaff(label: string, notice: Notice): Promise<void> {
    try {
      const to = await this.staffRecipients();
      if (!to.length) {
        this.logger.warn(`${label}: no staff email address to alert - it is waiting in Overseas.`);
        return;
      }
      await this.send(to, label, {
        ...notice,
        footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
      });
    } catch (err) {
      this.logger.warn(`${label}: staff alert failed - ${(err as Error).message}`);
    }
  }

  /**
   * For emergencies (a caregiver's SOS): the alert list AND every active
   * admin and staff account, so it cannot sit unread in one inbox.
   */
  async toAllStaff(label: string, notice: Notice): Promise<void> {
    try {
      const [list, everyone] = await Promise.all([this.staffRecipients(), this.activeStaffEmails()]);
      const to = [...new Set([...list, ...everyone].map((a) => a.toLowerCase()))];
      if (!to.length) {
        this.logger.error(`${label}: no staff email address at all - it is waiting in Overseas > Welfare.`);
        return;
      }
      await this.send(to, label, { ...notice, footer: 'Sent to every admin and staff account, and the request alert list in Settings > Email.' });
    } catch (err) {
      this.logger.error(`${label}: emergency alert failed - ${(err as Error).message}`);
    }
  }

  async toAddress(to: string | null | undefined, label: string, notice: Notice): Promise<void> {
    if (!to) return;
    try {
      await this.send(to, label, notice);
    } catch (err) {
      this.logger.warn(`${label}: notice failed - ${(err as Error).message}`);
    }
  }

  staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }

  publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  private async send(to: string | string[], label: string, notice: Notice & { footer?: string }) {
    await this.email.sendNotificationEmail(
      to,
      {
        subject: notice.subject,
        blocks: [{ lang: 'en', heading: notice.heading ?? notice.subject, paragraphs: notice.paragraphs }],
        ...(notice.cta ? { cta: notice.cta } : {}),
        ...(notice.footer ? { footer: notice.footer } : {}),
      },
      label,
    );
  }

  /** Same recipients as care request alerts: the configured list, else every active admin and staff account. */
  private async staffRecipients(): Promise<string[]> {
    const settings = await this.emailSettings.getResolved();
    if (settings.requestAlertsTo) {
      return settings.requestAlertsTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    }
    return this.activeStaffEmails();
  }

  private async activeStaffEmails(): Promise<string[]> {
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true), isNotNull(users.email)));
    return rows.map((r) => r.email!).filter(Boolean);
  }
}
