import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumberString, IsOptional, IsString } from 'class-validator';
import { shiftPreferenceEnum } from '../../database/schema/availability.schema';

export class UpsertAvailabilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dayDuty?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nightDuty?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  liveIn24h?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  availableFrom?: string;

  @ApiPropertyOptional({ enum: shiftPreferenceEnum })
  @IsOptional()
  @IsEnum(shiftPreferenceEnum)
  preferredShift?: (typeof shiftPreferenceEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  expectedDailyRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  expectedMonthlyRate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  expectedLeaveDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferredLeavePattern?: string;
}
