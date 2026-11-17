import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailSettingsService } from './email-settings.service';
import { EmailSettingsController } from './email-settings.controller';
import { StaffAlertsService } from './staff-alerts.service';

@Module({
  controllers: [EmailSettingsController],
  providers: [EmailService, EmailSettingsService, StaffAlertsService],
  exports: [EmailService, EmailSettingsService, StaffAlertsService],
})
export class EmailModule {}
