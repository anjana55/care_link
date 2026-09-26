import { Module } from '@nestjs/common';
import { QualificationsService } from './qualifications.service';
import { QualificationsController } from './qualifications.controller';

@Module({
  providers: [QualificationsService],
  controllers: [QualificationsController],
})
export class QualificationsModule {}
