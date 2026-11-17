import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { OnboardingAgentService } from './onboarding-agent.service';
import { OnboardingFileController, PublicReferencesController } from './onboarding.controller';

/** The onboarding agent and the referee's page. Documents and references nudge it by job. */
@Module({
  imports: [WhatsappModule, EmailModule],
  controllers: [PublicReferencesController, OnboardingFileController],
  providers: [OnboardingAgentService],
  exports: [OnboardingAgentService],
})
export class OnboardingModule {}
