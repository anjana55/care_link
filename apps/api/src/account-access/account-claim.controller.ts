import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';
import { AccountClaimService } from './account-claim.service';
import { StartAccountClaimDto, VerifyAccountClaimDto } from './dto/account-claim.dto';

/**
 * "Finish setting up your account" on the caregiver sign-in page: registration
 * number, then a code, then the same provider step the registration form ends
 * with. Tight throttles because both endpoints are anonymous.
 */
@ApiTags('auth')
@Controller('auth/caregiver/claim')
export class AccountClaimController {
  constructor(
    private readonly claims: AccountClaimService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('start')
  start(@Body() dto: StartAccountClaimDto) {
    return this.claims.start(dto.registrationNumber);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  async verify(@Body() dto: VerifyAccountClaimDto, @Req() req: Request) {
    const result = await this.claims.verify(dto.registrationNumber, dto.code);
    await this.audit.record({
      action: 'CLAIM_CAREGIVER_ACCOUNT',
      entityType: 'Caregiver',
      entityId: result.caregiverId,
      metadata: { channel: result.channel },
      ipAddress: req.ip,
    });
    return result;
  }
}
