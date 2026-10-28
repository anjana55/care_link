import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  MAX_CARE_ACTIVITIES,
  MAX_CARE_NOTES,
  MAX_CARE_REASON,
  MAX_CARE_TIMES,
  careActivityCategoryValues,
  careActivityTimingValues,
  careSlotValues,
  careTypeValues,
  type CareActivityCategory,
  type CareActivityTiming,
  type CareSlot,
  type CareType,
  type IsoWeekday,
  type LocalizedText,
} from '@care-platform/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DUE_KEY = /^(ANY|MORNING|AFTERNOON|EVENING|NIGHT|([01]\d|2[0-3]):[0-5]\d)$/;
const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** One activity on a template or a plan. Text is per language: { en, si, ta }. */
export class CareActivityDto {
  @ApiPropertyOptional({ description: 'Plans only: the id of the activity this keeps' })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ enum: careActivityCategoryValues })
  @IsIn(careActivityCategoryValues, { message: 'Choose a category for each activity' })
  category: CareActivityCategory;

  @ApiProperty({ example: { en: 'Give morning tablets' } })
  @IsObject({ message: 'Give each activity a title' })
  title: LocalizedText;

  @ApiPropertyOptional({ example: { en: 'With food; tell us if refused' } })
  @IsOptional()
  @IsObject()
  instructions?: LocalizedText;

  @ApiProperty({ enum: careActivityTimingValues })
  @IsIn(careActivityTimingValues, { message: 'Choose when each activity is done' })
  timing: CareActivityTiming;

  @ApiPropertyOptional({ enum: careSlotValues })
  @IsOptional()
  @IsIn(careSlotValues)
  slot?: CareSlot | null;

  @ApiPropertyOptional({ type: [String], example: ['08:00', '20:00'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CARE_TIMES)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true, message: 'Enter times as HH:MM' })
  times?: string[];

  @ApiPropertyOptional({ type: [Number], description: 'ISO weekdays; omit or null for every shift' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek?: IsoWeekday[] | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;
}

export class CarePlanTemplateDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Give the template a name' })
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(MAX_CARE_NOTES)
  description?: string | null;

  @ApiProperty({ enum: careTypeValues, isArray: true })
  @IsArray()
  @IsIn(careTypeValues, { each: true })
  careTypes: CareType[];

  @ApiProperty({ type: [CareActivityDto] })
  @IsArray()
  @ArrayMaxSize(MAX_CARE_ACTIVITIES, { message: 'A plan can have at most 60 activities' })
  @ValidateNested({ each: true })
  @Type(() => CareActivityDto)
  activities: CareActivityDto[];
}

export class CarePlanTemplateQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED', 'ALL'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED', 'ALL'])
  status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
}

export class CreateCarePlanDto {
  @ApiPropertyOptional({ description: 'Start from this template' })
  @IsOptional()
  @IsUUID('all')
  templateId?: string;

  @ApiPropertyOptional({ description: "Start from the plan on another of this client's bookings" })
  @IsOptional()
  @IsUUID('all')
  fromBookingId?: string;
}

export class UpdateCarePlanDto {
  @ApiProperty({ example: '2026-11-10', description: 'Colombo date the change takes effect' })
  @Matches(DATE, { message: 'Choose the date the change takes effect' })
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(MAX_CARE_NOTES)
  notes?: string | null;

  @ApiProperty({ type: [CareActivityDto] })
  @IsArray()
  @ArrayMaxSize(MAX_CARE_ACTIVITIES, { message: 'A plan can have at most 60 activities' })
  @ValidateNested({ each: true })
  @Type(() => CareActivityDto)
  activities: CareActivityDto[];
}

export class CareRecordDto {
  @ApiProperty()
  @IsUUID('all')
  shiftId: string;

  @ApiProperty()
  @IsUUID('all')
  activityId: string;

  @ApiProperty({ example: 'ANY' })
  @Matches(DUE_KEY)
  dueKey: string;

  @ApiProperty({ enum: ['DONE', 'NOT_DONE'] })
  @IsIn(['DONE', 'NOT_DONE'], { message: 'Choose Done or Not done' })
  status: 'DONE' | 'NOT_DONE';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(MAX_CARE_REASON)
  reason?: string | null;
}

export class CareDayQueryDto {
  @ApiPropertyOptional({ example: '2026-11-02' })
  @IsOptional()
  @Matches(DATE)
  date?: string;
}

export class CareLogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class CareRemindersDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
