import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { MatchingAgentService } from './matching-agent.service';

/** The matching agent: ranks caregivers for an open request and offers them the job. */
@Module({
  imports: [OffersModule],
  providers: [MatchingAgentService],
  exports: [MatchingAgentService],
})
export class MatchingModule {}
