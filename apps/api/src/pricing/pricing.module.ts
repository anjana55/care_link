import { Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { CaregiverRatesController, PricingSettingsController } from './pricing.controller';

/** Caregiver-set rates and the platform fee. */
@Module({
  controllers: [PricingSettingsController, CaregiverRatesController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
