import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { AccountDeletionNotifier } from './account-deletion.notifier';
import { AccountDeletionsController, MyAccountDeletionController } from './account-deletion.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountErasureJob } from './account-erasure.job';

/** "Delete my account": the request, the staff queue, and the hourly erasure. */
@Module({
  imports: [AuditModule, EmailModule],
  controllers: [MyAccountDeletionController, AccountDeletionsController],
  providers: [AccountDeletionService, AccountDeletionNotifier, AccountErasureJob],
  // Staff deleting a caregiver who asked to be deleted carries the request out (CaregiversService.remove).
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
