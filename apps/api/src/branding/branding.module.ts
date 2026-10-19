import { Global, Module } from '@nestjs/common';
import { BrandingSettingsService } from './branding-settings.service';
import { BrandingController, BrandingSettingsController } from './branding.controller';

/**
 * Global: the company name and colour are read by every module that sends a
 * message (email, WhatsApp, care-request and billing notifiers).
 */
@Global()
@Module({
  controllers: [BrandingSettingsController, BrandingController],
  providers: [BrandingSettingsService],
  exports: [BrandingSettingsService],
})
export class BrandingModule {}
