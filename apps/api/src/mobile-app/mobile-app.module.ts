import { Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { AppConfigController, AppSettingsController } from './mobile-app.controller';

/** Settings the mobile app reads that aren't about any one person: version control, for now. */
@Module({
  controllers: [AppSettingsController, AppConfigController],
  providers: [AppSettingsService],
})
export class MobileAppModule {}
