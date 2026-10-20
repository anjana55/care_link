import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { LOCALES, insightRangeValues, type InsightRange, type Locale } from '@care-platform/shared';

export class InsightsQueryDto {
  @ApiPropertyOptional({ enum: insightRangeValues, default: '30d' })
  @IsOptional()
  @IsIn(insightRangeValues)
  range?: InsightRange;

  /** Language for place names (districts). */
  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}
