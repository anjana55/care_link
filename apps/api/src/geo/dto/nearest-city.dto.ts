import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { LOCALES, type Locale } from '@care-platform/shared';

/**
 * A point from the visitor's browser ("Use my location"). Sent as a POST body,
 * not a query string, so coordinates never land in access logs; nothing about
 * it is stored.
 */
export class NearestCityDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsEnum(LOCALES)
  locale?: Locale;
}
