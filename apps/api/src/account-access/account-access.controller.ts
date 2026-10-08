import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { AccountAccessService } from './account-access.service';
import { ResetSignInDto } from './dto/reset-sign-in.dto';

/**
 * Staff tools for a caregiver's sign-in, under the caregiver they belong to.
 * Every change is audited with what it removed, never with a code or secret.
 */
@ApiTags('caregivers')
@ApiBearerAuth()
@Controller('caregivers')
export class AccountAccessController {
  constructor(
    private readonly access: AccountAccessService,
    private readonly audit: AuditService,
  ) {}

  @Get(':id/sign-in')
  @Roles('ADMIN', 'STAFF')
  methods(@Param('id') id: string) {
    return this.access.getSignInMethods(id);
  }

  /**
   * Admin only: taking a working sign-in away from someone is the most
   * sensitive thing on this screen, and the one most useful to an attacker who
   * has talked their way past a staff member.
   */
  @Post(':id/sign-in/reset')
  @Roles('ADMIN')
  async reset(@Param('id') id: string, @Body() dto: ResetSignInDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const result = await this.access.resetSignIn(id, dto);
    await this.audit.record({
      userId: user.userId,
      action: 'RESET_CAREGIVER_SIGN_IN',
      entityType: 'Caregiver',
      entityId: id,
      metadata: {
        unlinkedProviders: result.removed.providers,
        passwordRemoved: result.removed.password,
        releasedPhone: result.removed.phone,
        clearedEmail: result.removed.email,
      },
      ipAddress: req.ip,
    });
    return result.methods;
  }

  /**
   * Staff (not only admins) may issue codes: they are the people who meet
   * caregivers in person. Only allowed while the account is unsecured, so a
   * code can finish an account but never take over a working one.
   */
  @Post(':id/sign-in/claim-code')
  @Roles('ADMIN', 'STAFF')
  async claimCode(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const result = await this.access.issueStaffClaimCode(id, user.userId);
    await this.audit.record({
      userId: user.userId,
      action: 'ISSUE_CAREGIVER_CLAIM_CODE',
      entityType: 'Caregiver',
      entityId: id,
      metadata: { expiresAt: result.expiresAt.toISOString() },
      ipAddress: req.ip,
    });
    return result;
  }
}
