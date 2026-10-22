import { Module } from '@nestjs/common';
import { AdsSettingsService } from './ads-settings.service';
import { AdsController, AdsSettingsController } from './ads.controller';

@Module({
  controllers: [AdsSettingsController, AdsController],
  providers: [AdsSettingsService],
  exports: [AdsSettingsService],
})
export class AdsModule {}
