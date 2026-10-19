import { Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { BookingsService } from './bookings.service';
import { BookingNotifier } from './booking-notifier.service';
import { BookingsController, MyBookingsController } from './bookings.controller';

@Module({
  imports: [PublicSearchModule, EmailModule, WhatsappModule],
  controllers: [BookingsController, MyBookingsController],
  providers: [BookingsService, BookingNotifier],
  // The staff assistant runs approved booking changes through this service.
  exports: [BookingsService],
})
export class BookingsModule {}
