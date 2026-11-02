import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { LOGO_MAX_BYTES, brandAssetFromPath, type BrandAsset } from '@care-platform/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BrandingSettingsService } from './branding-settings.service';
import { UpdateBrandingSettingsDto } from './dto/update-branding-settings.dto';

/** `logo`, `logo-reverse`, `symbol` or `app-icon` -> the asset; anything else is not found. */
function assetParam(path: string): BrandAsset {
  const asset = brandAssetFromPath(path);
  if (!asset) throw new NotFoundException('No such brand asset');
  return asset;
}

/** Admin-only: company name, logo and the other artwork, colours and languages (Settings > Branding). */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/branding')
@Roles('ADMIN')
export class BrandingSettingsController {
  constructor(private readonly branding: BrandingSettingsService) {}

  @Get()
  get() {
    return this.branding.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_BRANDING_SETTINGS', entityType: 'BrandingSettings' })
  update(@Body() dto: UpdateBrandingSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.branding.update(dto, user.userId);
  }

  /** Upload the logo, reverse logo, symbol or app icon (BRAND_ASSETS). */
  @Post(':asset')
  @ApiConsumes('multipart/form-data')
  // A little over the limit so an oversized file reaches inspectLogo and gets its friendly message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1024 } }))
  @Audit({ action: 'UPDATE_BRANDING_ASSET', entityType: 'BrandingSettings' })
  uploadAsset(@Param('asset') path: string, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthenticatedUser) {
    return this.branding.setAsset(assetParam(path), file, user.userId);
  }

  @Delete(':asset')
  @Audit({ action: 'REMOVE_BRANDING_ASSET', entityType: 'BrandingSettings' })
  removeAsset(@Param('asset') path: string, @CurrentUser() user: AuthenticatedUser) {
    return this.branding.removeAsset(assetParam(path), user.userId);
  }
}

/**
 * What every page needs to paint itself - read by both web apps on every load,
 * signed in or not, so it is public and not throttled.
 */
@ApiTags('branding')
@Public()
@SkipThrottle()
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingSettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response) {
    // Revalidated on every load so a saved change shows on the next one.
    res.set('Cache-Control', 'no-cache');
    return this.branding.getPublic();
  }

  /**
   * The logo, reverse logo, symbol or app icon as uploaded - or, with
   * `?size=`, as a PNG that size on its longer side (for the mobile app).
   */
  @Get(':asset')
  async asset(
    @Param('asset') path: string,
    @Query('v') v: string | undefined,
    @Query('size') size: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asset = assetParam(path);
    let file: { buffer: Buffer; mimeType: string; version: string };
    if (size !== undefined) {
      if (!/^\d{1,4}$/.test(size)) throw new BadRequestException('size must be a number of pixels');
      const png = await this.branding.getAssetPng(asset, Number(size));
      file = { ...png, mimeType: 'image/png' };
    } else {
      file = await this.branding.getAsset(asset);
    }
    res.set({
      'Content-Type': file.mimeType,
      // Versioned URLs never change content; an unversioned or stale one is checked again soon.
      'Cache-Control': v === file.version ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
      // Loaded as an <img> by the web apps, which in development run on other ports.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Opened directly, an SVG is a document on the API's origin: give it nothing to run with.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${path}"`,
    });
    return new StreamableFile(file.buffer);
  }
}
