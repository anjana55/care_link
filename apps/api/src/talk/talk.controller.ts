import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { TalkService } from './talk.service';
import { HandleTalkRequestDto, TalkRequestDto } from './dto/talk.dto';

/** A client or caregiver asks to talk to a person. */
@ApiTags('talk')
@ApiBearerAuth()
@Roles('PATIENT_GUARDIAN', 'CAREGIVER')
@Controller('me/talk-to-a-person')
export class MyTalkController {
  constructor(private readonly talk: TalkService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  ask(@Body() dto: TalkRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.talk.ask(user, dto);
  }

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.talk.listMine(user);
  }
}

/** Staff: People waiting. */
@ApiTags('talk')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('talk-requests')
export class TalkRequestsController {
  constructor(private readonly talk: TalkService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.talk.list(status === 'HANDLED' || status === 'ALL' ? status : 'OPEN');
  }

  @Post(':id/handled')
  @HttpCode(200)
  @Audit({ action: 'HANDLE_TALK_REQUEST', entityType: 'TalkRequest' })
  handled(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HandleTalkRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.talk.handle(id, dto.note, user);
  }
}
