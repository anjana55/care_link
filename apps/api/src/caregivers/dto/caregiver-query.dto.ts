import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { caregiverStatusEnum } from '../../database/schema/caregivers.schema';
import { genderEnum } from '../../database/schema/caregivers.schema';

function toIdList({ value }: { value: unknown }): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

function toNumberList({ value }: { value: unknown }): number[] {
  const parts = toIdList({ value });
  return parts.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

function toBoolean({ value }: { value: unknown }): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === '1';
}

export class CaregiverQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search across name, registration number and phone' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: caregiverStatusEnum })
  @IsOptional()
  @IsEnum(caregiverStatusEnum)
  status?: (typeof caregiverStatusEnum)[number];

  @ApiPropertyOptional({ enum: genderEnum })
  @IsOptional()
  @IsEnum(genderEnum)
  gender?: (typeof genderEnum)[number];

  @ApiPropertyOptional({
    type: [String],
    description: 'Comma-separated skill IDs. A caregiver must have ALL listed skills to match.',
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  skillIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Comma-separated language IDs. A caregiver must speak ALL listed languages to match.',
  })
  @IsOptional()
  @Transform(toIdList)
  @IsArray()
  @IsString({ each: true })
  languageIds?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'Comma-separated city IDs from the locations reference data. A caregiver matches if they prefer ANY of the listed cities.',
  })
  @IsOptional()
  @Transform(toNumberList)
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  locationIds?: number[];

  @ApiPropertyOptional({ description: 'Only caregivers available for day duty' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  dayDuty?: boolean;

  @ApiPropertyOptional({ description: 'Only caregivers available for night duty' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  nightDuty?: boolean;

  @ApiPropertyOptional({ description: 'Only caregivers available for 24-hour live-in duty' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  liveIn24h?: boolean;

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

  @ApiPropertyOptional({ enum: ['fullName', 'createdAt', 'registrationNumber', 'status'] })
  @IsOptional()
  @IsIn(['fullName', 'createdAt', 'registrationNumber', 'status'])
  sortBy: 'fullName' | 'createdAt' | 'registrationNumber' | 'status' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';
}

