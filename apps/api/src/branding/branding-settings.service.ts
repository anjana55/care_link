import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import {
  DEFAULT_COMPANY_NAME,
  LOGO_MAX_BYTES,
  MIN_BRAND_CONTRAST,
  contrastRatio,
  initialsOf,
  meetsBrandContrast,
  normalizeLocales,
  resolveLocale,
  type Locale,
  type PublicBranding,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { billingSettings, brandingSettings, emailSettings } from '../database/schema';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';

const SETTINGS_ID = 'default';
type Row = typeof brandingSettings.$inferSelect;

export type LogoMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
const EXTENSION: Record<LogoMimeType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

export interface AdminBranding extends PublicBranding {
  logoMimeType: string | null;
  updatedAt: Date;
}

/**
 * What an uploaded logo really is, from its bytes rather than the browser's
 * word for it. SVG is accepted only without anything that can run or reach
 * out: the logo is served from the API's own origin, so an SVG carrying a
 * script would be a stored XSS on every page that links it.
 */
export function inspectLogo(buffer: Buffer): LogoMimeType {
  if (!buffer?.length) throw new BadRequestException('Choose an image file for the logo');
  if (buffer.length > LOGO_MAX_BYTES) throw new BadRequestException('The logo must be 1 MB or smaller');

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';

  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const head = text.replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>[]*>\s*)?/i, '');
  if (/^<svg[\s>]/i.test(head)) {
    const unsafe =
      /<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|\bon[a-z]+\s*=|javascript:|data:text\/html|(?:xlink:)?href\s*=\s*(?!["']?\s*(?:#|data:image\/(?:png|jpeg|webp|gif);))/i;
    if (unsafe.test(text)) throw new BadRequestException('This SVG contains scripts or links to other files. Export a plain SVG, or upload a PNG instead.');
    return 'image/svg+xml';
  }
  throw new BadRequestException('The logo must be a PNG, JPEG, WebP or SVG image');
}

/**
 * Owns the single admin-managed branding row (Settings > Branding). Read on
 * every use rather than cached, like the other settings, so a change applies
 * at once on every API instance - and in every email sent after it.
 */
@Injectable()
export class BrandingSettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  private async getRow(): Promise<Row> {
    const [existing] = await this.db.select().from(brandingSettings).where(eq(brandingSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(brandingSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(brandingSettings).where(eq(brandingSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private toPublic(row: Row): PublicBranding {
    const defaultLocale = resolveLocale(row.defaultLocale);
    return {
      companyName: row.companyName || DEFAULT_COMPANY_NAME,
      shortName: row.shortName || initialsOf(row.companyName || DEFAULT_COMPANY_NAME),
      tagline: row.tagline || null,
      primaryColor: row.primaryColor.toUpperCase(),
      accentColor: row.accentColor.toUpperCase(),
      logoVersion: row.logoKey ? row.logoVersion : null,
      defaultLocale,
      enabledLocales: normalizeLocales(row.enabledLocales.split(','), defaultLocale),
    };
  }

  async getPublic(): Promise<PublicBranding> {
    return this.toPublic(await this.getRow());
  }

  /** The company name for outgoing messages. Never throws: a message is not worth failing over its sign-off. */
  async companyName(): Promise<string> {
    try {
      return (await this.getPublic()).companyName;
    } catch {
      return DEFAULT_COMPANY_NAME;
    }
  }

  async getForAdmin(): Promise<AdminBranding> {
    const row = await this.getRow();
    return { ...this.toPublic(row), logoMimeType: row.logoKey ? row.logoMimeType : null, updatedAt: row.updatedAt };
  }

  async update(dto: UpdateBrandingSettingsDto, updatedBy: string): Promise<AdminBranding> {
    const current = await this.getRow();
    const companyName = dto.companyName !== undefined ? dto.companyName.trim() : current.companyName;
    if (!companyName) throw new BadRequestException('Enter the company name');
    // Stored as given; a blank one is filled from the company name when read.
    const shortName = dto.shortName !== undefined ? dto.shortName.trim().toUpperCase() : current.shortName;
    const tagline = dto.tagline !== undefined ? dto.tagline.trim() || null : current.tagline;
    const primaryColor = (dto.primaryColor ?? current.primaryColor).toUpperCase();
    const accentColor = (dto.accentColor ?? current.accentColor).toUpperCase();

    for (const [label, color] of [['primary', primaryColor], ['accent', accentColor]] as const) {
      if (!meetsBrandContrast(color)) {
        throw new BadRequestException(
          `The ${label} colour ${color} is too light for white text (contrast ${contrastRatio(color, '#FFFFFF').toFixed(2)}:1, needs ${MIN_BRAND_CONTRAST}:1). Choose a darker shade.`,
        );
      }
    }

    const defaultLocale: Locale = dto.defaultLocale ?? resolveLocale(current.defaultLocale);
    const requested = dto.enabledLocales ?? (current.enabledLocales.split(',') as Locale[]);
    // Switching only the default turns that language on; an explicit list that leaves it out is a mistake.
    if (dto.enabledLocales && !dto.enabledLocales.includes(defaultLocale)) {
      throw new BadRequestException('The default language must be one of the languages offered');
    }
    const enabledLocales = normalizeLocales(requested, defaultLocale);

    await this.db
      .update(brandingSettings)
      .set({ companyName, shortName, tagline, primaryColor, accentColor, defaultLocale, enabledLocales: enabledLocales.join(','), updatedBy, updatedAt: new Date() })
      .where(eq(brandingSettings.id, SETTINGS_ID));

    // The email sender name and the invoice business name start out as the
    // company name. Where they still are, they follow a rename; a value an
    // admin set differently on its own page is left alone.
    if (companyName !== current.companyName) {
      await this.db.update(emailSettings).set({ fromName: companyName }).where(eq(emailSettings.fromName, current.companyName));
      await this.db.update(billingSettings).set({ businessName: companyName }).where(eq(billingSettings.businessName, current.companyName));
    }
    return this.getForAdmin();
  }

  async setLogo(file: { buffer: Buffer } | undefined, updatedBy: string): Promise<AdminBranding> {
    const mimeType = inspectLogo(file?.buffer as Buffer);
    const current = await this.getRow();
    const version = randomBytes(6).toString('hex');
    const key = `branding/logo-${version}.${EXTENSION[mimeType]}`;
    await this.storage.upload({ key, buffer: file!.buffer, mimeType });
    await this.db
      .update(brandingSettings)
      .set({ logoKey: key, logoMimeType: mimeType, logoVersion: version, updatedBy, updatedAt: new Date() })
      .where(eq(brandingSettings.id, SETTINGS_ID));
    // The old file goes only once the row no longer points at it.
    if (current.logoKey && current.logoKey !== key) await this.storage.delete(current.logoKey);
    return this.getForAdmin();
  }

  async removeLogo(updatedBy: string): Promise<AdminBranding> {
    const current = await this.getRow();
    await this.db
      .update(brandingSettings)
      .set({ logoKey: null, logoMimeType: null, logoVersion: null, updatedBy, updatedAt: new Date() })
      .where(eq(brandingSettings.id, SETTINGS_ID));
    if (current.logoKey) await this.storage.delete(current.logoKey);
    return this.getForAdmin();
  }

  async getLogo(): Promise<{ buffer: Buffer; mimeType: string; version: string }> {
    const row = await this.getRow();
    if (!row.logoKey || !row.logoMimeType || !row.logoVersion) throw new NotFoundException('No logo has been uploaded');
    return { buffer: await this.storage.download(row.logoKey), mimeType: row.logoMimeType, version: row.logoVersion };
  }
}
