import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  careScheduleEnum,
  careStartEnum,
  clientStatusEnum,
  contactMethodEnum,
  registrantTypeEnum,
} from '../../database/schema';

/**
 * Query params for the staff clients list. Trimmed from CaregiverQueryDto
 * (caregivers/dto/caregiver-query.dto.ts) to the facets a client actually has:
 * a patient/guardian has no skills, languages, locations or availability,
 * so those filters - and the ID-subquery machinery behind them - do not apply.
 *
 * The intake facets (districtId/cityId, careSchedule, careStart,
 * contactMethod, registrantType) are the ones the clients list page filters
 * by place and need first. They only match rows registered through the intake
 * form, so every client who signed up before it has none of them and drops out
 * of a filtered view - the same nullability the columns themselves carry.
 */
export class PatientQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search across name, phone and account email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: clientStatusEnum })
  @IsOptional()
  @IsEnum(clientStatusEnum)
  status?: (typeof clientStatusEnum)[number];

  @ApiPropertyOptional({ description: 'Only clients whose linked login account is active (or inactive)' })
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Only clients who need care in this district' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;

  @ApiPropertyOptional({ description: 'Only clients who need care in this city' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId?: number;

  @ApiPropertyOptional({ enum: careScheduleEnum })
  @IsOptional()
  @IsEnum(careScheduleEnum)
  careSchedule?: (typeof careScheduleEnum)[number];

  @ApiPropertyOptional({ enum: careStartEnum })
  @IsOptional()
  @IsEnum(careStartEnum)
  careStart?: (typeof careStartEnum)[number];

  @ApiPropertyOptional({ enum: contactMethodEnum })
  @IsOptional()
  @IsEnum(contactMethodEnum)
  contactMethod?: (typeof contactMethodEnum)[number];

  @ApiPropertyOptional({ enum: registrantTypeEnum })
  @IsOptional()
  @IsEnum(registrantTypeEnum)
  registrantType?: (typeof registrantTypeEnum)[number];

  @ApiPropertyOptional({ enum: ['VERIFIED', 'UNVERIFIED'], description: 'Whether the client has confirmed their email address / WhatsApp number' })
  @IsOptional()
  @IsIn(['VERIFIED', 'UNVERIFIED'])
  verification?: 'VERIFIED' | 'UNVERIFIED';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number = 20;

  @ApiPropertyOptional({ enum: ['fullName', 'createdAt', 'status'] })
  @IsOptional()
  @IsIn(['fullName', 'createdAt', 'status'])
  sortBy: 'fullName' | 'createdAt' | 'status' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';
}