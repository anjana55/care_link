import { Module } from '@nestjs/common';
import { WhatsappSettingsService } from './whatsapp-settings.service';
import { WhatsappProviderService } from './whatsapp-provider.service';
import { WhatsappOtpService } from './whatsapp-otp.service';
import { WhatsappSettingsController } from './whatsapp-settings.controller';

@Module({
  controllers: [WhatsappSettingsController],
  providers: [WhatsappSettingsService, WhatsappProviderService, WhatsappOtpService],
  exports: [WhatsappSettingsService, WhatsappProviderService, WhatsappOtpService],
})
export class WhatsappModule {}
