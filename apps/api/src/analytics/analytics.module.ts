import { Module } from '@nestjs/common';
import { AnalyticsSettingsService } from './analytics-settings.service';
import { AnalyticsController, AnalyticsSettingsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsSettingsController, AnalyticsController],
  providers: [AnalyticsSettingsService],
  exports: [AnalyticsSettingsService],
})
export class AnalyticsModule {}
