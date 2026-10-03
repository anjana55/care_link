import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { clientStatusEnum } from '../../database/schema/patients.schema';

/**
 * Query params for the staff clients list. Trimmed from CaregiverQueryDto
 * (caregivers/dto/caregiver-query.dto.ts) to the facets a client actually has:
 * a patient/guardian has no skills, languages, locations or availability,
 * so those filters - and the ID-subquery machinery behind them - do not apply.
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