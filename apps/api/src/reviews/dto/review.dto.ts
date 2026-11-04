import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  MAX_REVIEW_COMMENT,
  MAX_REVIEW_PRIVATE_NOTE,
  MAX_REVIEW_REASON,
  REVIEW_BADGES,
  REVIEW_IMPROVEMENT_TAGS,
  STAFF_REVIEW_FILTERS,
  type ReviewBadge,
  type ReviewImprovementTag,
  type StaffReviewFilter,
} from '@care-platform/shared';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** PUT /me/bookings/:bookingId/reviews/:caregiverPublicId - create or replace the client's review. */
export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt({ message: 'Choose 1 to 5 stars' })
  @Min(1, { message: 'Choose 1 to 5 stars' })
  @Max(5, { message: 'Choose 1 to 5 stars' })
  rating: number;

  @ApiPropertyOptional({ enum: REVIEW_BADGES, isArray: true })
  @IsOptional()
  @IsArray({ message: 'Choose badges from the list' })
  @ArrayMaxSize(REVIEW_BADGES.length, { message: 'Choose badges from the list' })
  @IsIn(REVIEW_BADGES, { each: true, message: 'Choose badges from the list' })
  badges?: ReviewBadge[];

  @ApiPropertyOptional({ enum: REVIEW_IMPROVEMENT_TAGS, isArray: true })
  @IsOptional()
  @IsArray({ message: 'Choose what could be better from the list' })
  @ArrayMaxSize(REVIEW_IMPROVEMENT_TAGS.length, { message: 'Choose what could be better from the list' })
  @IsIn(REVIEW_IMPROVEMENT_TAGS, { each: true, message: 'Choose what could be better from the list' })
  improvementTags?: ReviewImprovementTag[];

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_REVIEW_COMMENT })
  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Write your review as text' })
  @MaxLength(MAX_REVIEW_COMMENT, { message: 'Please keep your review under 1000 characters' })
  comment?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_REVIEW_PRIVATE_NOTE })
  @IsOptional()
  @Transform(trimToNull)
  @IsString({ message: 'Write your note as text' })
  @MaxLength(MAX_REVIEW_PRIVATE_NOTE, { message: 'Please keep your note to the office under 500 characters' })
  privateNote?: string | null;
}

/** Staff: rejecting a written review, or hiding a whole one. The reason is kept; for a rejection the client is told it. */
export class ReviewReasonDto {
  @ApiProperty({ maxLength: MAX_REVIEW_REASON })
  @Transform(trimToUndefined)
  @IsString({ message: 'Give a reason' })
  @MinLength(3, { message: 'Give a reason' })
  @MaxLength(MAX_REVIEW_REASON, { message: 'Please keep the reason under 300 characters' })
  reason: string;
}

export class StaffReviewQueryDto {
  @ApiPropertyOptional({ enum: STAFF_REVIEW_FILTERS })
  @IsOptional()
  @IsIn(STAFF_REVIEW_FILTERS, { message: 'Choose a valid filter' })
  filter?: StaffReviewFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  caregiverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class PublicReviewsQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Choose a valid page' })
  @Min(1, { message: 'Choose a valid page' })
  @Max(1000, { message: 'Choose a valid page' })
  page?: number;

  @ApiPropertyOptional({ enum: ['en', 'si', 'ta'] })
  @IsOptional()
  @IsString()
  locale?: string;
}

/** Settings > Reviews. */
export class UpdateReviewSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  minRatingsToShow?: number;

  @ApiPropertyOptional({ minimum: 7, maximum: 365 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  windowDays?: number;
}
