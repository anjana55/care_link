import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { BillingModule } from '../billing/billing.module';
import { CorrectionsService } from './corrections.service';
import { CorrectionsController } from './corrections.controller';

/** Booking corrections: they change the roster through BookingsService and the documents through billing. */
@Module({
  imports: [BookingsModule, BillingModule],
  controllers: [CorrectionsController],
  providers: [CorrectionsService],
})
export class CorrectionsModule {}
