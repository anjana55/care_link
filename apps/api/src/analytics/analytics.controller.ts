import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

/** Admin-only: Google Analytics measurement ID and on/off (Settings > Analytics). */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/analytics')
@Roles('ADMIN')
export class AnalyticsSettingsController {
  constructor(private readonly analytics: AnalyticsSettingsService) {}

  @Get()
  get() {
    return this.analytics.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_ANALYTICS_SETTINGS', entityType: 'AnalyticsSettings' })
  update(@Body() dto: UpdateAnalyticsSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.analytics.update(dto, user.userId);
  }
}

/**
 * What the public site needs to load Google Analytics - read on every page
 * load, signed in or not, so it is public and not throttled. Nothing in it is
 * secret.
 */
@ApiTags('analytics')
@Public()
@SkipThrottle()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsSettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response) {
    // Revalidated on every load so switching measurement off shows on the next one.
    res.set('Cache-Control', 'no-cache');
    return this.analytics.getPublic();
  }
}
