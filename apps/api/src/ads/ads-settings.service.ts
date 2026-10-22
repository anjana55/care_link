import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  ADSENSE_PUBLISHER_ID_RE,
  DISABLED_ADS,
  adsTxtLine,
  normalizePublisherId,
  normalizeSlotId,
  type PublicAdsConfig,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { adsSettings } from '../database/schema';
import { UpdateAdsSettingsDto } from './dto/update-ads-settings.dto';

const SETTINGS_ID = 'default';
type Row = typeof adsSettings.$inferSelect;

export interface AdminAdsSettings {
  enabled: boolean;
  publisherId: string | null;
  slotHome: string | null;
  slotSearch: string | null;
  slotProfile: string | null;
  /** The line to publish at /ads.txt; null until there is a publisher ID. */
  adsTxt: string | null;
  updatedAt: Date;
}

const SLOT_FIELDS = [
  ['slotHome', 'landing page'],
  ['slotSearch', 'search results'],
  ['slotProfile', 'caregiver profile'],
] as const;

/**
 * Owns the single admin-managed AdSense row (Settings > Ads). Read on every use
 * rather than cached, like the other settings, so switching ads off applies on
 * the next page load on every instance.
 */
@Injectable()
export class AdsSettingsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(adsSettings).where(eq(adsSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(adsSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(adsSettings).where(eq(adsSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private toPublic(row: Row): PublicAdsConfig {
    const publisherId = row.publisherId && ADSENSE_PUBLISHER_ID_RE.test(row.publisherId) ? row.publisherId : null;
    if (!row.enabled || !publisherId) return DISABLED_ADS;
    return {
      enabled: true,
      publisherId,
      slots: { home: normalizeSlotId(row.slotHome), search: normalizeSlotId(row.slotSearch), profile: normalizeSlotId(row.slotProfile) },
    };
  }

  /** What the public site needs. Never throws: a broken settings read means no ads, not a broken page. */
  async getPublic(): Promise<PublicAdsConfig> {
    try {
      return this.toPublic(await this.getRow());
    } catch {
      return DISABLED_ADS;
    }
  }

  async getForAdmin(): Promise<AdminAdsSettings> {
    const row = await this.getRow();
    return {
      enabled: row.enabled,
      publisherId: row.publisherId,
      slotHome: row.slotHome,
      slotSearch: row.slotSearch,
      slotProfile: row.slotProfile,
      adsTxt: row.publisherId ? adsTxtLine(row.publisherId) : null,
      updatedAt: row.updatedAt,
    };
  }

  async update(dto: UpdateAdsSettingsDto, updatedBy: string): Promise<AdminAdsSettings> {
    const current = await this.getRow();

    let publisherId = current.publisherId;
    if (dto.publisherId !== undefined) {
      if (!dto.publisherId.trim()) publisherId = null;
      else {
        publisherId = normalizePublisherId(dto.publisherId);
        if (!publisherId) {
          throw new BadRequestException('Enter the AdSense publisher ID as shown in AdSense, e.g. ca-pub-0123456789012345');
        }
      }
    }

    const slots = { slotHome: current.slotHome, slotSearch: current.slotSearch, slotProfile: current.slotProfile };
    for (const [field, label] of SLOT_FIELDS) {
      const value = dto[field];
      if (value === undefined) continue;
      if (!value.trim()) slots[field] = null;
      else {
        const slot = normalizeSlotId(value);
        if (!slot) throw new BadRequestException(`The ${label} ad unit ID must be the digits from data-ad-slot, e.g. 1234567890`);
        slots[field] = slot;
      }
    }

    const enabled = dto.enabled ?? current.enabled;
    if (enabled && !publisherId) throw new BadRequestException('Enter your AdSense publisher ID before switching ads on');

    await this.db
      .update(adsSettings)
      .set({ enabled, publisherId, ...slots, updatedBy, updatedAt: new Date() })
      .where(eq(adsSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
