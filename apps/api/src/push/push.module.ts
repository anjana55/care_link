import { Global, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { PushService } from './push.service';

/**
 * Push notifications to the mobile app. Global: every notifier that sends a
 * WhatsApp or email message also offers a push, and sign-out revokes devices.
 */
@Global()
@Module({
  controllers: [DevicesController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
