import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { TalkService } from './talk.service';
import { MyTalkController, TalkRequestsController } from './talk.controller';

@Module({
  imports: [EmailModule],
  controllers: [MyTalkController, TalkRequestsController],
  providers: [TalkService],
  exports: [TalkService],
})
export class TalkModule {}
