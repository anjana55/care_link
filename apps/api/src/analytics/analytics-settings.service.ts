import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DISABLED_ANALYTICS,
  GA_MEASUREMENT_ID_RE,
  normalizeMeasurementId,
  type PublicAnalyticsConfig,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { analyticsSettings } from '../database/schema';
import { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

const SETTINGS_ID = 'default';
type Row = typeof analyticsSettings.$inferSelect;

export interface AdminAnalyticsSettings {
  enabled: boolean;
  measurementId: string | null;
  updatedAt: Date;
}

/**
 * Owns the single admin-managed Google Analytics row (Settings > Analytics).
 * Read on every use rather than cached, like the other settings, so switching
 * measurement off applies on the next page load on every instance.
 */
@Injectable()
export class AnalyticsSettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(analyticsSettings).where(eq(analyticsSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(analyticsSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(analyticsSettings).where(eq(analyticsSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  /** What the public site needs. Never throws: a broken settings read means no analytics, not a broken page. */
  async getPublic(): Promise<PublicAnalyticsConfig> {
    try {
      const row = await this.getRow();
      const measurementId = row.measurementId && GA_MEASUREMENT_ID_RE.test(row.measurementId) ? row.measurementId : null;
      return row.enabled && measurementId ? { enabled: true, measurementId } : DISABLED_ANALYTICS;
    } catch {
      return DISABLED_ANALYTICS;
    }
  }

  async getForAdmin(): Promise<AdminAnalyticsSettings> {
    const row = await this.getRow();
    return { enabled: row.enabled, measurementId: row.measurementId, updatedAt: row.updatedAt };
  }

  async update(dto: UpdateAnalyticsSettingsDto, updatedBy: string): Promise<AdminAnalyticsSettings> {
    const current = await this.getRow();

    let measurementId = current.measurementId;
    if (dto.measurementId !== undefined) {
      if (!dto.measurementId.trim()) measurementId = null;
      else {
        measurementId = normalizeMeasurementId(dto.measurementId);
        if (!measurementId) {
          throw new BadRequestException('Enter the Google Analytics measurement ID as shown in Analytics, e.g. G-AB12CD34EF');
        }
      }
    }

    const enabled = dto.enabled ?? current.enabled;
    if (enabled && !measurementId) throw new BadRequestException('Enter your measurement ID before switching Google Analytics on');

    await this.db
      .update(analyticsSettings)
      .set({ enabled, measurementId, updatedBy, updatedAt: new Date() })
      .where(eq(analyticsSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
