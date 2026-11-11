import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { MAX_FEE_PERCENT, MAX_RATE_LKR, careTypeValues, pricingRateTypeValues, type CareType, type PricingRateType } from '@care-platform/shared';

/** PATCH /settings/pricing/:careType */
export class UpdateCareTypePricingDto {
  @ApiPropertyOptional({ description: 'Let caregivers set their own rate for this kind of care' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: pricingRateTypeValues })
  @IsOptional()
  @IsIn(pricingRateTypeValues)
  rateType?: PricingRateType;

  @ApiPropertyOptional({ description: 'Lowest rate a caregiver may ask, LKR' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_RATE_LKR)
  minRate?: number;

  @ApiPropertyOptional({ description: 'Highest rate a caregiver may ask, LKR' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_RATE_LKR)
  maxRate?: number;

  @ApiPropertyOptional({ description: "Added to the caregiver's rate for the client's price, percent" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_FEE_PERCENT)
  feePercent?: number;
}

export class RateEntryDto {
  @ApiProperty({ enum: careTypeValues })
  @IsIn(careTypeValues)
  careType: CareType;

  @ApiProperty({ nullable: true, description: 'LKR, in the unit this kind of care is priced in. null removes the rate.' })
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_RATE_LKR)
  amount: number | null;
}

/** PUT /caregivers/:caregiverId/rates - only the care types sent are changed. */
export class UpdateCaregiverRatesDto {
  @ApiProperty({ type: [RateEntryDto] })
  @IsArray()
  @ArrayMaxSize(careTypeValues.length)
  @ValidateNested({ each: true })
  @Type(() => RateEntryDto)
  rates: RateEntryDto[];
}
