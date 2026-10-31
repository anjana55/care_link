import { Body, Controller, Get, Patch, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingsDto } from './dto/update-app-settings.dto';

/** Admin-only: the mobile app's minimum and latest versions and store links (Settings > Mobile app). */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/mobile-app')
@Roles('ADMIN')
export class AppSettingsController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_APP_SETTINGS', entityType: 'AppSettings' })
  update(@Body() dto: UpdateAppSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }
}

/**
 * What the mobile app checks at start-up: must this build be updated, or may
 * it be? Read signed out, so it's public; nothing in it is secret.
 */
@ApiTags('mobile-app')
@Public()
@Controller('public/app-config')
export class AppConfigController {
  constructor(private readonly settings: AppSettingsService) {}

  @Get()
  async get(@Res({ passthrough: true }) res: Response) {
    // Revalidated on every start, so raising the minimum takes effect at once.
    res.set('Cache-Control', 'no-cache');
    return this.settings.getPublic();
  }
}
