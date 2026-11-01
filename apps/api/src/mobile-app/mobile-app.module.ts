import { Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service';
import { AppConfigController, AppLinksController, AppSettingsController } from './mobile-app.controller';

/** Settings the mobile app reads that aren't about any one person: version control and app links. */
@Module({
  controllers: [AppSettingsController, AppConfigController, AppLinksController],
  providers: [AppSettingsService],
})
export class MobileAppModule {}
