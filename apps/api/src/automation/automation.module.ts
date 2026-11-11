import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AutomationService } from './automation.service';
import { AutomationController, AutomationSettingsController } from './automation.controller';

/**
 * The rail the agents run on (Settings > Automation). Global, so any module
 * that grows an agent can ask the gate without importing this one - and
 * depending only on the database and email, so it can never be part of an
 * import cycle with the modules it gates.
 */
@Global()
@Module({
  imports: [EmailModule],
  controllers: [AutomationSettingsController, AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
