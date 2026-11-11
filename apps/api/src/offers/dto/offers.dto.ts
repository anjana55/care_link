import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  MAX_CARE_OFFER_NOTE,
  MAX_RATE_LKR,
  CARE_OFFER_DECLINE_REASONS,
  CARE_OFFER_MINUTES,
  pricingRateTypeValues,
  type CareOfferDeclineReason,
  type PricingRateType,
  type SendCareOfferInput,
} from '@care-platform/shared';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** POST /care-requests/:id/offers */
export class SendOfferDto implements SendCareOfferInput {
  @ApiProperty()
  @IsUUID('all', { message: 'Choose a caregiver' })
  caregiverId: string;

  @ApiPropertyOptional({ minimum: CARE_OFFER_MINUTES.min, maximum: CARE_OFFER_MINUTES.max, default: CARE_OFFER_MINUTES.default })
  @IsOptional()
  @IsInt()
  @Min(CARE_OFFER_MINUTES.min)
  @Max(CARE_OFFER_MINUTES.max)
  expiresInMinutes?: number;

  @ApiPropertyOptional({ maxLength: MAX_CARE_OFFER_NOTE })
  @IsOptional()
  @Transform(trimToNull)
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(MAX_CARE_OFFER_NOTE)
  note?: string | null;

  @ApiPropertyOptional({ enum: pricingRateTypeValues, description: 'With payRate: a rate entered by hand, when the caregiver has none of their own to use' })
  @IsOptional()
  @IsIn(pricingRateTypeValues)
  rateType?: PricingRateType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(MAX_RATE_LKR)
  payRate?: number;
}

/** POST /me/offers/:id/decline */
export class DeclineOfferDto {
  @ApiPropertyOptional({ enum: CARE_OFFER_DECLINE_REASONS })
  @IsOptional()
  @IsIn(CARE_OFFER_DECLINE_REASONS)
  reason?: CareOfferDeclineReason;
}
