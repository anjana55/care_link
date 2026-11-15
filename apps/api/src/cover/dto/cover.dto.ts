import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAX_CARE_OFFER_NOTE, MAX_COVER_OFFERS_PER_SEND, type SendCoverOffersInput } from '@care-platform/shared';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** POST /visits/:shiftId/cover/offers */
export class SendCoverOffersDto implements SendCoverOffersInput {
  @ApiProperty({ type: [String], maxItems: MAX_COVER_OFFERS_PER_SEND })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one caregiver' })
  @ArrayMaxSize(MAX_COVER_OFFERS_PER_SEND, { message: 'Too many caregivers at once' })
  @IsUUID('all', { each: true, message: 'Choose a caregiver' })
  caregiverIds: string[];

  @ApiPropertyOptional({ minimum: 5, maximum: 24 * 60, description: 'Minutes to answer. Default: by how soon the shift is' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  expiresInMinutes?: number;

  @ApiPropertyOptional({ maxLength: MAX_CARE_OFFER_NOTE })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(MAX_CARE_OFFER_NOTE)
  note?: string | null;
}
