import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountDeletionsController, MyAccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountErasureJob } from './account-erasure.job';

/** "Delete my account": the request, the staff queue, and the hourly erasure. */
@Module({
  imports: [AuditModule],
  controllers: [MyAccountDeletionController, AccountDeletionsController],
  providers: [AccountDeletionService, AccountErasureJob],
})
export class AccountDeletionModule {}
