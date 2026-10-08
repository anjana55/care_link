import { Module } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';
import { CaregiversController } from './caregivers.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [CaregiversService],
  controllers: [CaregiversController],
  exports: [CaregiversService],
})
export class CaregiversModule {}
