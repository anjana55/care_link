import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { BookingsModule } from '../bookings/bookings.module';
import { EmailModule } from '../email/email.module';
import { CandidatePoolModule } from '../matching/candidate-pool.module';
import { CorrectionsModule } from '../corrections/corrections.module';
import { CoverService } from './cover.service';
import { CoverAgentService } from './cover-agent.service';
import { CoverController } from './cover.controller';

/**
 * Cover for a shift whose caregiver cannot come. It sits above offers (the
 * offer itself), bookings (the shift) and the candidate pool (who to ask);
 * none of them know about it - it registers itself with them at start-up.
 */
@Module({
  imports: [OffersModule, BookingsModule, CorrectionsModule, EmailModule, CandidatePoolModule],
  controllers: [CoverController],
  providers: [CoverService, CoverAgentService],
  exports: [CoverService, CoverAgentService],
})
export class CoverModule {}
