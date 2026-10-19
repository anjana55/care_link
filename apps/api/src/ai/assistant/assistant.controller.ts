import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';

export class SendAssistantMessageDto {
  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Write a message first' })
  @MaxLength(4000, { message: 'Please keep messages under 4000 characters' })
  content: string;
}

/**
 * The staff assistant. ADMIN and STAFF - the roles that work requests and
 * bookings; the assistant can do nothing they could not do on the pages.
 * Approvals are audited by AssistantService under the same action names as
 * the pages (with `via: assistant`), so there is no @Audit here to double them.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.assistant.list(user);
  }

  @Post('conversations')
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.assistant.create(user);
  }

  @Get('conversations/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.get(id, user);
  }

  @Delete('conversations/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.remove(id, user);
  }

  @Post('conversations/:id/messages')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  send(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SendAssistantMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.send(id, dto.content, user);
  }

  @Post('actions/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.assistant.approve(id, user, req.ip ?? null);
  }

  @Post('actions/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assistant.reject(id, user);
  }
}
