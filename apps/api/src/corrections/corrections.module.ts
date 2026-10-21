import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { BillingModule } from '../billing/billing.module';
import { CorrectionsService } from './corrections.service';
import { CorrectionsController, IssueReportsController, MyIssueReportsController } from './corrections.controller';
import { CorrectionsNotifier } from './corrections-notifier.service';
import { IssueReportsService } from './issue-reports.service';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

/**
 * Booking corrections - which change the roster through BookingsService and the
 * documents through billing - and the issue reports clients and caregivers send.
 */
@Module({
  imports: [BookingsModule, BillingModule, EmailModule, WhatsappModule],
  controllers: [CorrectionsController, IssueReportsController, MyIssueReportsController],
  providers: [CorrectionsService, CorrectionsNotifier, IssueReportsService],
})
export class CorrectionsModule {}
