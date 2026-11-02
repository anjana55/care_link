import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';

/** Only the page's path: what it means is looked up on the server (assistant-context.ts). */
export class AssistantContextDto {
  @ApiProperty({ example: '/bookings/0b6f0d0e-1c55-4d8a-9a8e-2f1c7c3f4a10' })
  @IsString()
  @MaxLength(200)
  @Matches(/^\/[A-Za-z0-9/_-]*$/, { message: 'Invalid page' })
  path: string;
}

export class SendAssistantMessageDto {
  @ApiProperty({ maxLength: 4000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: 'Write a message first' })
  @MaxLength(4000, { message: 'Please keep messages under 4000 characters' })
  content: string;

  @ApiProperty({ required: false, description: 'Where the staff member is in the app when they ask' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
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
    return this.assistant.send(id, dto.content, user, dto.context);
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
