import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AccountAccessController } from './account-access.controller';
import { AccountAccessService } from './account-access.service';
import { AccountClaimController } from './account-claim.controller';
import { AccountClaimService } from './account-claim.service';
import { ClaimCodesService } from './claim-codes.service';

/**
 * Resetting a caregiver's sign-in (staff) and finishing an unsecured account
 * with a registration number (public). Kept out of AuthModule so the
 * established sign-in flows are not touched; it only borrows
 * SocialAuthService.pendingLinkGrant to hand over the provider step.
 */
@Module({
  imports: [AuditModule, AuthModule, EmailModule, WhatsappModule],
  providers: [AccountAccessService, AccountClaimService, ClaimCodesService],
  controllers: [AccountAccessController, AccountClaimController],
})
export class AccountAccessModule {}
