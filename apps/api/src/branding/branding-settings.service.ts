import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import {
  APP_ICON_MIN_PX,
  BRAND_PNG_SIZES,
  DEFAULT_COMPANY_NAME,
  LOGO_MAX_BYTES,
  SQUARE_BRAND_ASSETS,
  type BrandAsset,
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
  /** Each asset's file type, null when it isn't uploaded. */
  assetMimeTypes: Record<BrandAsset, string | null>;
  updatedAt: Date;
}

/** Where each asset lives in the branding row. */
const COLUMNS = {
  logo: { key: 'logoKey', mime: 'logoMimeType', version: 'logoVersion' },
  logoReverse: { key: 'logoReverseKey', mime: 'logoReverseMimeType', version: 'logoReverseVersion' },
  symbol: { key: 'symbolKey', mime: 'symbolMimeType', version: 'symbolVersion' },
  appIcon: { key: 'appIconKey', mime: 'appIconMimeType', version: 'appIconVersion' },
} as const satisfies Record<BrandAsset, { key: keyof Row; mime: keyof Row; version: keyof Row }>;

/** File names in storage. */
const FILE_STEM: Record<BrandAsset, string> = { logo: 'logo', logoReverse: 'logo-reverse', symbol: 'symbol', appIcon: 'app-icon' };

const versionOf = (row: Row, asset: BrandAsset): string | null => (row[COLUMNS[asset].key] ? (row[COLUMNS[asset].version] as string | null) : null);

/**
 * The shape rules the stores and small spaces need: the symbol and app icon
 * square, the app icon big enough not to blur, and none of them too small to
 * be crisp. Read from the decoded picture (an SVG's own size or viewBox).
 */
export async function checkAssetShape(asset: BrandAsset, buffer: Buffer): Promise<void> {
  let width = 0;
  let height = 0;
  let vector = false;
  try {
    const meta = await sharp(buffer, { limitInputPixels: 50_000_000 }).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    vector = meta.format === 'svg';
  } catch {
    throw new BadRequestException('This picture could not be read. Export it again as PNG or SVG.');
  }
  if (!width || !height) throw new BadRequestException('This picture has no size. Export it again with a width and height.');
  if (SQUARE_BRAND_ASSETS.includes(asset) && Math.abs(width - height) / Math.max(width, height) > 0.05) {
    throw new BadRequestException(`This picture must be square (this one is ${width} × ${height}).`);
  }
  if (asset === 'appIcon' && !vector && Math.min(width, height) < APP_ICON_MIN_PX) {
    throw new BadRequestException(`The app icon must be at least ${APP_ICON_MIN_PX} × ${APP_ICON_MIN_PX} pixels, or an SVG (this one is ${width} × ${height}).`);
  }
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
      logoVersion: versionOf(row, 'logo'),
      assets: { logo: versionOf(row, 'logo'), logoReverse: versionOf(row, 'logoReverse'), symbol: versionOf(row, 'symbol'), appIcon: versionOf(row, 'appIcon') },
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
    const mimeOf = (asset: BrandAsset) => (row[COLUMNS[asset].key] ? (row[COLUMNS[asset].mime] as string | null) : null);
    return {
      ...this.toPublic(row),
      logoMimeType: mimeOf('logo'),
      assetMimeTypes: { logo: mimeOf('logo'), logoReverse: mimeOf('logoReverse'), symbol: mimeOf('symbol'), appIcon: mimeOf('appIcon') },
      updatedAt: row.updatedAt,
    };
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

  async setAsset(asset: BrandAsset, file: { buffer: Buffer } | undefined, updatedBy: string): Promise<AdminBranding> {
    const mimeType = inspectLogo(file?.buffer as Buffer);
    await checkAssetShape(asset, file!.buffer);
    const current = await this.getRow();
    const cols = COLUMNS[asset];
    const version = randomBytes(6).toString('hex');
    const key = `branding/${FILE_STEM[asset]}-${version}.${EXTENSION[mimeType]}`;
    await this.storage.upload({ key, buffer: file!.buffer, mimeType });
    await this.db
      .update(brandingSettings)
      .set({ [cols.key]: key, [cols.mime]: mimeType, [cols.version]: version, updatedBy, updatedAt: new Date() })
      .where(eq(brandingSettings.id, SETTINGS_ID));
    // The old file goes only once the row no longer points at it.
    const old = current[cols.key] as string | null;
    if (old && old !== key) await this.storage.delete(old);
    return this.getForAdmin();
  }

  async removeAsset(asset: BrandAsset, updatedBy: string): Promise<AdminBranding> {
    const current = await this.getRow();
    const cols = COLUMNS[asset];
    await this.db
      .update(brandingSettings)
      .set({ [cols.key]: null, [cols.mime]: null, [cols.version]: null, updatedBy, updatedAt: new Date() })
      .where(eq(brandingSettings.id, SETTINGS_ID));
    const old = current[cols.key] as string | null;
    if (old) await this.storage.delete(old);
    return this.getForAdmin();
  }

  async getAsset(asset: BrandAsset): Promise<{ buffer: Buffer; mimeType: string; version: string }> {
    const row = await this.getRow();
    const cols = COLUMNS[asset];
    const key = row[cols.key] as string | null;
    const mimeType = row[cols.mime] as string | null;
    const version = row[cols.version] as string | null;
    if (!key || !mimeType || !version) throw new NotFoundException('This picture has not been uploaded');
    return { buffer: await this.storage.download(key), mimeType, version };
  }

  /** Recent renditions, so the app asking for the same icon all day doesn't re-render it. */
  private readonly renditions = new Map<string, Buffer>();

  /**
   * The asset as a PNG `size` px on its longer side, transparent around it -
   * for the mobile app, which can't draw SVG, and for the store icon. Sizes
   * are a fixed list, so nobody can make the API render a giant picture.
   */
  async getAssetPng(asset: BrandAsset, size: number): Promise<{ buffer: Buffer; version: string }> {
    if (!(BRAND_PNG_SIZES as readonly number[]).includes(size)) {
      throw new BadRequestException(`size must be one of ${BRAND_PNG_SIZES.join(', ')}`);
    }
    const original = await this.getAsset(asset);
    const cacheKey = `${asset}:${original.version}:${size}`;
    const hit = this.renditions.get(cacheKey);
    if (hit) return { buffer: hit, version: original.version };

    const meta = await sharp(original.buffer).metadata();
    const longest = Math.max(meta.width ?? size, meta.height ?? size);
    // An SVG is drawn at the density that makes it `size` px, so it is sharp rather than scaled up.
    const density = meta.format === 'svg' ? Math.min(2400, Math.max(1, Math.ceil((72 * size) / longest))) : undefined;
    const buffer = await sharp(original.buffer, { density, limitInputPixels: 50_000_000 })
      // A raster picture is never blown up (it would only blur); an SVG is already drawn at the size asked for.
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    if (this.renditions.size >= 64) this.renditions.delete(this.renditions.keys().next().value!);
    this.renditions.set(cacheKey, buffer);
    return { buffer, version: original.version };
  }

  // The logo, as before the other assets existed.
  setLogo(file: { buffer: Buffer } | undefined, updatedBy: string) {
    return this.setAsset('logo', file, updatedBy);
  }

  removeLogo(updatedBy: string) {
    return this.removeAsset('logo', updatedBy);
  }

  getLogo() {
    return this.getAsset('logo');
  }
}
