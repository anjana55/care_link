import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsISO8601, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CHECK_IN_NOTE_MAX } from '@care-platform/shared';

const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** PATCH /settings/check-in */
export class UpdateCheckInSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 240 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  earlyMinutes?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  lateAfterMinutes?: number;
}

/** Where the phone is, when it can say. All optional: a phone with no fix still checks in. */
export class PositionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'How sure the phone is, in metres' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracyM?: number;
}

/** POST /me/shifts/:id/check-in */
export class CheckInDto extends PositionDto {
  @ApiProperty({ description: "The client's four-digit arrival code" })
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value))
  @IsString({ message: 'Enter the 4-digit code the client gives you' })
  @Matches(/^\d{4}$/, { message: 'Enter the 4-digit code the client gives you' })
  code: string;
}

/** POST /visits/:shiftId/check-in and /check-out (staff) */
export class StaffCheckInDto {
  @ApiPropertyOptional({ description: 'When it happened, if not now' })
  @IsOptional()
  @IsISO8601({}, { message: 'Enter a valid time' })
  at?: string;

  @ApiPropertyOptional({ maxLength: CHECK_IN_NOTE_MAX })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(CHECK_IN_NOTE_MAX)
  note?: string;
}
