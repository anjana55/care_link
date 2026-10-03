import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { LOCALES } from '@care-platform/shared';

const blankToUndefined = ({ value }: TransformFnParams) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (value === null) return undefined;
  return value;
};

export class TreeQueryDto {
  /** Which language's names to return. Anything unrecognised resolves to
   * English - see resolveLocale, which the service applies to whatever
   * survives validation. This is a public endpoint, so the value is
   * attacker-controlled and must never reach the database as an identifier. */
  @ApiPropertyOptional({ enum: LOCALES, default: 'en' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  locale?: string;
}

export class CitiesQueryDto {
  @ApiProperty({ description: 'Districts are identified by their CSV id, not by name.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId: number;

  @ApiPropertyOptional({ enum: LOCALES, default: 'en' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  locale?: string;
}

export class BrowseCitiesQueryDto {
  /** Optional: the browse page can list every city, or narrow to one district. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 50;

  @ApiPropertyOptional({ enum: LOCALES, default: 'en' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString()
  locale?: string;
}
