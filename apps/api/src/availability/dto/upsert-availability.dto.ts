import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumberString, IsOptional, IsString } from 'class-validator';
import { careTypeValues, type CareType } from '@care-platform/shared';
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

  @ApiPropertyOptional({ enum: careTypeValues, isArray: true, description: 'The kinds of care this caregiver takes on. At least one.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one type of care' })
  @ArrayUnique()
  @IsIn(careTypeValues, { each: true, message: 'Choose a valid type of care' })
  careTypes?: CareType[];

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
