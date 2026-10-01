import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { genderEnum } from '../../database/schema/caregivers.schema';
import { shiftPreferenceEnum } from '../../database/schema/availability.schema';
import { RequireSearchCriteria } from './require-search-criteria.validator';

export const genderPreferenceEnum = ['MALE', 'FEMALE', 'ANY'] as const;

/**
 * Server-side mirror of `blankToUndefined` in @care-platform/shared. A browser
 * submits an untouched `valueAsNumber` input as `NaN` and a blank `<select>` as
 * `''`; neither is `undefined`, so `@IsOptional()` alone rejects them. The zod
 * schema strips these before the request leaves the public-web form, but this
 * is a public endpoint and must not depend on every caller having run that
 * schema first - a hand-written request or a future client would otherwise be
 * rejected for leaving a field blank.
 */
const blankToUndefined = ({ value }: TransformFnParams) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (value === null || (typeof value === 'number' && Number.isNaN(value))) return undefined;
  return value;
};

/**
 * District and desired start date are the only mandatory inputs; everything
 * else is a refinement, deliberately a "guardian fills in whatever they know"
 * shape rather than a set of required hard filters. Which of those become
 * hard filters vs. ranking signals is decided in PublicSearchService, not here
 * (see the architecture: only status + mandatory skills are hard filters;
 * gender/budget/optional skills influence ranking only).
 *
 * Note that `desiredStartDate` is validated but not yet consumed - the
 * availability feature that will read it is not implemented, so today it
 * constrains the request without changing the result set.
 */
class PatientInfoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE'] })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsEnum(['MALE', 'FEMALE'])
  gender?: 'MALE' | 'FEMALE';

  @ApiPropertyOptional({ type: [String], description: 'Free-text medical conditions, optional' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  medicalConditions?: string[];
}

class LocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(100)
  city?: string;
}

class BudgetDto {
  @ApiPropertyOptional({ description: 'Daily rate ceiling. Influences ranking only - never a hard filter.' })
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional({ description: 'Monthly rate ceiling. Influences ranking only - never a hard filter.' })
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyRate?: number;
}

export class SearchRequestDto {
  /**
   * Declaration target for the class-level {@link RequireSearchCriteria}
   * constraint - never populated by a client, never read.
   */
  @RequireSearchCriteria()
  private readonly _searchCriteria?: never;

  @ApiPropertyOptional({ type: PatientInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatientInfoDto)
  patient?: PatientInfoDto;

  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @ApiPropertyOptional({ enum: genderPreferenceEnum, description: 'Preference, not a hard filter unless ANY is omitted entirely by the caller choosing not to send it' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsEnum(genderPreferenceEnum)
  caregiverGenderPreference?: (typeof genderPreferenceEnum)[number];

  @ApiPropertyOptional({ type: [String], description: 'Skill IDs the caregiver MUST have (hard filter)' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mandatorySkillIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Skill IDs that influence ranking only' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  optionalSkillIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  languageIds?: string[];

  @ApiPropertyOptional({ enum: shiftPreferenceEnum })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsEnum(shiftPreferenceEnum)
  shift?: (typeof shiftPreferenceEnum)[number];

  @ApiPropertyOptional()
  // Stays @IsOptional so a *missing* date yields only the class-level
  // "desiredStartDate is required" rather than also a confusing "must be a
  // valid ISO 8601 date string". A supplied-but-malformed value still fails.
  @IsOptional()
  @IsDateString()
  desiredStartDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  minimumExperienceYears?: number;

  @ApiPropertyOptional({ type: BudgetDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetDto)
  budget?: BudgetDto;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page: number = 1;

  // Deliberately capped well below the staff-side page size ceiling - see
  // architecture P (pagination hard cap / enumeration protection).
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}

export { genderEnum };
