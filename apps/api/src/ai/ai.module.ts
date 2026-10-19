import { Global, Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { CareRequestsModule } from '../care-requests/care-requests.module';
import { BookingsModule } from '../bookings/bookings.module';
import { AuditModule } from '../audit/audit.module';
import { AiSettingsService } from './ai-settings.service';
import { AiProviderService } from './ai-provider.service';
import { AiMatchingService } from './ai-matching.service';
import { AiSettingsController, AiStatusController, CareRequestSuggestionsController, PublicAiSearchController } from './ai.controller';
import { AssistantToolbox } from './assistant/assistant-toolbox.service';
import { AssistantService } from './assistant/assistant.service';
import { AssistantController } from './assistant/assistant.controller';

/**
 * Settings > AI and the model client. Global, so PublicSearchController can
 * read the AI switch for /public/meta/search-config without PublicSearchModule
 * importing the feature module that itself depends on it.
 */
@Global()
@Module({
  controllers: [AiSettingsController, AiStatusController],
  providers: [AiSettingsService, AiProviderService],
  exports: [AiSettingsService, AiProviderService],
})
export class AiCoreModule {}

/** The AI features: public AI Search, staff caregiver suggestions and the staff assistant. */
@Module({
  imports: [PublicSearchModule, CareRequestsModule, BookingsModule, AuditModule],
  controllers: [PublicAiSearchController, CareRequestSuggestionsController, AssistantController],
  providers: [AiMatchingService, AssistantToolbox, AssistantService],
})
export class AiModule {}
