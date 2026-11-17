import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { IntakeAgentService } from './intake-agent.service';

/** The intake agent. Depends on nothing but the database, automation, jobs, notices and WhatsApp; requests nudge it by job. */
@Module({
  imports: [WhatsappModule, EmailModule],
  providers: [IntakeAgentService],
  exports: [IntakeAgentService],
})
export class IntakeModule {}
