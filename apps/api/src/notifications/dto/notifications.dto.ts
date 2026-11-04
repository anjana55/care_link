import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ANNOUNCEMENT_AUDIENCES, MAX_ANNOUNCEMENT_BODY, MAX_ANNOUNCEMENT_TITLE, type AnnouncementAudience } from '@care-platform/shared';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** GET /me/notifications */
export class NotificationsQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor from the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  before?: string;
}

/** POST /me/notifications/read - some by id, those about some app paths, or all. */
export class MarkReadDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ type: [String], description: 'App paths, e.g. /invoices/<id>: marks every notification about them read' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^\/[A-Za-z0-9/_-]{0,200}$/, { each: true })
  paths?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

export class UpdateNotificationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quietStartHour?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quietEndHour?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  dailyReminderCap?: number;

  @ApiPropertyOptional({ minimum: 30, maximum: 730 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  retentionDays?: number;
}

export class AnnouncementTextDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Write a title' })
  @MaxLength(MAX_ANNOUNCEMENT_TITLE)
  title: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Write the message' })
  @MaxLength(MAX_ANNOUNCEMENT_BODY)
  body: string;
}

class OptionalAnnouncementTextDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_ANNOUNCEMENT_TITLE)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_ANNOUNCEMENT_BODY)
  body?: string;
}

/** POST /announcements and PATCH /announcements/:id (a draft). Sinhala and Tamil fall back to English where left empty. */
export class SaveAnnouncementDto {
  @ApiProperty({ enum: ANNOUNCEMENT_AUDIENCES })
  @IsIn(ANNOUNCEMENT_AUDIENCES as unknown as string[], { message: 'Choose who it is for' })
  audience: AnnouncementAudience;

  @ApiProperty({ type: AnnouncementTextDto })
  @ValidateNested()
  @Type(() => AnnouncementTextDto)
  en: AnnouncementTextDto;

  @ApiPropertyOptional({ type: OptionalAnnouncementTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptionalAnnouncementTextDto)
  si?: OptionalAnnouncementTextDto;

  @ApiPropertyOptional({ type: OptionalAnnouncementTextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OptionalAnnouncementTextDto)
  ta?: OptionalAnnouncementTextDto;

  @ApiPropertyOptional({ description: 'A page on the site (/...) or an https:// address' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  @Matches(/^(\/[^\s]*|https:\/\/[^\s]+)$/, { message: 'The link must start with / or https://' })
  link?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  important?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendPush?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;
}
