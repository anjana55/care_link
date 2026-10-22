import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdsSettingsService } from './ads-settings.service';
import { UpdateAdsSettingsDto } from './dto/update-ads-settings.dto';

/** Admin-only: Google AdSense publisher ID, on/off and ad units (Settings > Ads). */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/ads')
@Roles('ADMIN')
export class AdsSettingsController {
  constructor(private readonly ads: AdsSettingsService) {}

  @Get()
  get() {
    return this.ads.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_ADS_SETTINGS', entityType: 'AdsSettings' })
  update(@Body() dto: UpdateAdsSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ads.update(dto, user.userId);
  }
}

/**
 * What the public site needs to show ads - read on every page load, signed in
 * or not, so it is public and not throttled. Nothing in it is secret.
 */
@ApiTags('ads')
@Public()
@SkipThrottle()
@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsSettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response) {
    // Revalidated on every load so switching ads off shows on the next one.
    res.set('Cache-Control', 'no-cache');
    return this.ads.getPublic();
  }
}
