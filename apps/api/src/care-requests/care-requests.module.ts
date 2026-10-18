import { Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CareRequestsService } from './care-requests.service';
import { SavedCaregiversService } from './saved-caregivers.service';
import { CareRequestNotifier } from './care-request-notifier.service';
import { CareRequestsController } from './care-requests.controller';
import { ClientCareRequestsController } from './client-care-requests.controller';

@Module({
  imports: [PublicSearchModule, EmailModule, WhatsappModule],
  controllers: [CareRequestsController, ClientCareRequestsController],
  providers: [CareRequestsService, SavedCaregiversService, CareRequestNotifier],
  exports: [CareRequestsService],
})
export class CareRequestsModule {}
