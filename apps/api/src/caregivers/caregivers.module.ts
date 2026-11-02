import { Module } from '@nestjs/common';
import { CaregiversService } from './caregivers.service';
import { CaregiversController } from './caregivers.controller';
import { AuditModule } from '../audit/audit.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';

@Module({
  imports: [AuditModule, AccountDeletionModule],
  providers: [CaregiversService],
  controllers: [CaregiversController],
  exports: [CaregiversService],
})
export class CaregiversModule {}
