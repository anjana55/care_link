import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_SETTINGS_LIMITS, type NotificationSettings } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { notificationSettings } from '../database/schema';
import type { UpdateNotificationSettingsDto } from './dto/notifications.dto';

const SETTINGS_ID = 'default';
type Row = typeof notificationSettings.$inferSelect;

const toSettings = (row: Row): NotificationSettings => ({
  remindersEnabled: row.remindersEnabled,
  quietStartHour: row.quietStartHour,
  quietEndHour: row.quietEndHour,
  dailyReminderCap: row.dailyReminderCap,
  retentionDays: row.retentionDays,
});

/** Settings > Notifications: one row, read on every use rather than cached, so a change applies at once. */
@Injectable()
export class NotificationSettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(notificationSettings).where(eq(notificationSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(notificationSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(notificationSettings).where(eq(notificationSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  /** Never throws: a broken read falls back to the defaults. */
  async getResolved(): Promise<NotificationSettings> {
    try {
      return toSettings(await this.getRow());
    } catch {
      return DEFAULT_NOTIFICATION_SETTINGS;
    }
  }

  async getForAdmin(): Promise<NotificationSettings & { updatedAt: Date }> {
    const row = await this.getRow();
    return { ...toSettings(row), updatedAt: row.updatedAt };
  }

  async update(dto: UpdateNotificationSettingsDto, userId: string) {
    const next: Partial<typeof notificationSettings.$inferInsert> = { updatedBy: userId, updatedAt: new Date() };
    const within = (v: number, { min, max }: { min: number; max: number }, what: string) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${what} must be between ${min} and ${max}`);
      return v;
    };
    if (dto.remindersEnabled !== undefined) next.remindersEnabled = dto.remindersEnabled;
    if (dto.quietStartHour !== undefined) next.quietStartHour = within(dto.quietStartHour, NOTIFICATION_SETTINGS_LIMITS.hour, 'The quiet hours start');
    if (dto.quietEndHour !== undefined) next.quietEndHour = within(dto.quietEndHour, NOTIFICATION_SETTINGS_LIMITS.hour, 'The quiet hours end');
    if (dto.dailyReminderCap !== undefined) next.dailyReminderCap = within(dto.dailyReminderCap, NOTIFICATION_SETTINGS_LIMITS.dailyReminderCap, 'Reminders a day');
    if (dto.retentionDays !== undefined) next.retentionDays = within(dto.retentionDays, NOTIFICATION_SETTINGS_LIMITS.retentionDays, 'Days kept');
    await this.getRow();
    await this.db.update(notificationSettings).set(next).where(eq(notificationSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
