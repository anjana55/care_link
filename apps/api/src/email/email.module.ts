import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailSettingsService } from './email-settings.service';
import { EmailSettingsController } from './email-settings.controller';

@Module({
  controllers: [EmailSettingsController],
  providers: [EmailService, EmailSettingsService],
  exports: [EmailService, EmailSettingsService],
})
export class EmailModule {}
