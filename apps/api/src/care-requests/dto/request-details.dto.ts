import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Matches, Min, ValidateIf } from 'class-validator';
import { careTypeValues, type CareType, type ClientRequestDetailsInput } from '@care-platform/shared';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** PATCH /me/care-requests/:id/details: the client fills in what intake asked for. */
export class RequestDetailsDto implements ClientRequestDetailsInput {
  @ApiPropertyOptional({ enum: careTypeValues })
  @IsOptional()
  @IsIn(careTypeValues, { message: 'Choose the kind of care' })
  careType?: CareType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt({ message: 'Choose the district where care is needed' })
  @Min(1, { message: 'Choose the district where care is needed' })
  districtId?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt({ message: 'Choose the town' })
  cityId?: number | null;

  @ApiPropertyOptional({ enum: ['DAY', 'NIGHT', 'LIVE_IN_24H'] })
  @IsOptional()
  @IsIn(['DAY', 'NIGHT', 'LIVE_IN_24H'], { message: 'Choose when in the day care is needed' })
  schedule?: 'DAY' | 'NIGHT' | 'LIVE_IN_24H';

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @Matches(DATE, { message: 'Enter a valid start date' })
  desiredStartDate?: string;
}
