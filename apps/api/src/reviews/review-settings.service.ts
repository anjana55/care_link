import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_LIMITS, type ReviewSettings } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { reviewSettings } from '../database/schema';
import type { UpdateReviewSettingsDto } from './dto/review.dto';

const SETTINGS_ID = 'default';
type Row = typeof reviewSettings.$inferSelect;

const toSettings = (row: Row): ReviewSettings => ({ enabled: row.enabled, minRatingsToShow: row.minRatingsToShow, windowDays: row.windowDays });

/**
 * Settings > Reviews: one row, read on every request rather than cached, like
 * the other settings, so a change applies at once.
 */
@Injectable()
export class ReviewSettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(reviewSettings).where(eq(reviewSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(reviewSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(reviewSettings).where(eq(reviewSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  /** Never throws: a broken settings read falls back to the defaults rather than breaking search or profiles. */
  async getResolved(): Promise<ReviewSettings> {
    try {
      return toSettings(await this.getRow());
    } catch {
      return DEFAULT_REVIEW_SETTINGS;
    }
  }

  async getForAdmin(): Promise<ReviewSettings & { updatedAt: Date }> {
    const row = await this.getRow();
    return { ...toSettings(row), updatedAt: row.updatedAt };
  }

  async update(dto: UpdateReviewSettingsDto, userId: string) {
    const next: Partial<typeof reviewSettings.$inferInsert> = { updatedBy: userId, updatedAt: new Date() };
    if (dto.enabled !== undefined) next.enabled = dto.enabled;
    if (dto.minRatingsToShow !== undefined) {
      const { min, max } = REVIEW_SETTINGS_LIMITS.minRatingsToShow;
      if (dto.minRatingsToShow < min || dto.minRatingsToShow > max) throw new BadRequestException(`Ratings needed must be between ${min} and ${max}`);
      next.minRatingsToShow = dto.minRatingsToShow;
    }
    if (dto.windowDays !== undefined) {
      const { min, max } = REVIEW_SETTINGS_LIMITS.windowDays;
      if (dto.windowDays < min || dto.windowDays > max) throw new BadRequestException(`The review window must be between ${min} and ${max} days`);
      next.windowDays = dto.windowDays;
    }
    await this.getRow();
    await this.db.update(reviewSettings).set(next).where(eq(reviewSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
