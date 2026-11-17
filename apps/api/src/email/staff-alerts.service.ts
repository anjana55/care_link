import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { users } from '../database/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from './email.service';
import { EmailSettingsService } from './email-settings.service';

export interface StaffAlert {
  subject: string;
  /** The first paragraph also goes on the staff bell. Keep health details out: this is email. */
  paragraphs: string[];
  /** Staff app path, e.g. /requests/:id. */
  path: string;
  cta: string;
  /** For the logs, and to tell one alert from another. */
  label: string;
}

/**
 * Tells staff about something an agent handed back: the staff bell, and an
 * email to the alert list (Settings > Email), or else to every active admin
 * and staff account.
 */
@Injectable()
export class StaffAlertsService {
  private readonly logger = new Logger(StaffAlertsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly notices: NotificationsService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  async tell(a: StaffAlert): Promise<void> {
    this.notices.notifyStaff(a.subject, a.paragraphs[0] ?? '', a.path, a.label);
    try {
      const to = await this.recipients();
      if (!to.length) return void this.logger.warn(`${a.subject} - but there is nobody to email`);
      const base = (this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '');
      await this.email.sendNotificationEmail(to, { subject: a.subject, blocks: [{ lang: 'en', heading: a.subject, paragraphs: a.paragraphs }], cta: { label: a.cta, url: `${base}${a.path}` } }, a.label);
    } catch (err) {
      this.logger.warn(`${a.label}: staff email failed - ${(err as Error).message}`);
    }
  }

  async recipients(): Promise<string[]> {
    const settings = await this.emailSettings.getResolved();
    if (settings.requestAlertsTo) {
      return settings.requestAlertsTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    }
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true)));
    return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
  }
}
