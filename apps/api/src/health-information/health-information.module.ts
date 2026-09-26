import { Module } from '@nestjs/common';
import { HealthInformationService } from './health-information.service';
import { HealthInformationController } from './health-information.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [HealthInformationService],
  controllers: [HealthInformationController],
})
export class HealthInformationModule {}
