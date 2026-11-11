import { Module } from '@nestjs/common';
import { CareRequestsModule } from '../care-requests/care-requests.module';
import { PricingModule } from '../pricing/pricing.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { OffersService } from './offers.service';
import { MyOffersController, RequestOffersController } from './offers.controller';

/** Job offers: a request offered to caregivers, answered by them. */
@Module({
  imports: [CareRequestsModule, PricingModule, EmailModule, WhatsappModule],
  controllers: [RequestOffersController, MyOffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
