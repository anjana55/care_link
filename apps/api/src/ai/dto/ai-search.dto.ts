import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { LOCALES, type AiExtractRequest, type AiSearchRequestBody, type Locale } from '@care-platform/shared';
import { SearchRequestDto } from '../../public-search/dto/search-request.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** POST /public/ai/extract */
export class AiExtractDto implements AiExtractRequest {
  /**
   * The family's words - one or more messages, newline-separated, when the
   * assistant has asked a follow-up (e.g. "where is the care needed?") and
   * the answer was appended. Short is fine: a bare town name is a valid start.
   */
  @ApiProperty({ minLength: 2, maxLength: 1000, example: 'My 78 year old mother in Kandy has dementia and needs a female caregiver at night' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Tell us a little more about the care you need' })
  @MaxLength(1000, { message: 'Please keep the description under 1000 characters' })
  query: string;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional()
  @IsIn(LOCALES)
  locale?: Locale;
}

/** POST /public/ai/search - same validation as Normal Search for the request itself. */
export class AiSearchDto implements AiSearchRequestBody {
  @ApiProperty({ type: SearchRequestDto })
  @ValidateNested()
  @Type(() => SearchRequestDto)
  request: SearchRequestDto;

  @ApiProperty({ maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  query: string;
}
