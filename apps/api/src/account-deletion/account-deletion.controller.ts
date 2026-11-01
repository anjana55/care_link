import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AccountDeletionService } from './account-deletion.service';

/**
 * "Delete my account" for a caregiver or client, from the app or the website.
 * The account is locked at once, so this is the last call its tokens make.
 */
@ApiTags('account')
@ApiBearerAuth()
@Controller('me/account/deletion')
@Roles('CAREGIVER', 'PATIENT_GUARDIAN')
export class MyAccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Post()
  @HttpCode(200)
  request(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.deletion.request(user, req.ip ?? null);
  }
}

/** Staff: the deletion requests, what still holds each one back, and cancelling one in its grace period. */
@ApiTags('account')
@ApiBearerAuth()
@Controller('account-deletions')
@Roles('ADMIN', 'STAFF')
export class AccountDeletionsController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Get()
  list() {
    return this.deletion.list();
  }

  /** How many are waiting: the badge on Account deletions in the staff app. */
  @Get('summary')
  summary() {
    return this.deletion.summary();
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.deletion.cancel(id, user.userId, req.ip ?? null);
  }
}
