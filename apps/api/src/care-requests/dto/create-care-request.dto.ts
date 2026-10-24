import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import { CARE_REQUEST_MESSAGE_MAX, careTypeValues, type CareType } from '@care-platform/shared';

const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const blankToUndefined = ({ value }: { value: unknown }) => (value === '' || value === null ? undefined : value);

/**
 * POST /me/care-requests.
 *
 * With `caregiverPublicId` it is "Contact this caregiver" - the client names
 * the caregiver by public id only. Without one it is "find a caregiver for
 * me": then the care type and the district are required, so staff have
 * something to match on. The search details (care type, place, start date)
 * ride along on a Contact too, when the client came from a search.
 */
export class CreateCareRequestDto {
  @ApiPropertyOptional({ description: "The caregiver's public id, as shown on the public profile. Omit to ask our team to find someone." })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsUUID('all', { message: 'Choose a caregiver to contact' })
  caregiverPublicId?: string;

  @ApiPropertyOptional({ maxLength: CARE_REQUEST_MESSAGE_MAX, description: 'Anything the client wants staff to know. Seen by staff only.' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(CARE_REQUEST_MESSAGE_MAX, { message: 'Your message is too long - please keep it under 1000 characters' })
  message?: string;

  @ApiPropertyOptional({ enum: careTypeValues, description: 'Required when no caregiver is chosen' })
  @ValidateIf((o: CreateCareRequestDto) => !o.caregiverPublicId || o.careType !== undefined)
  @Transform(blankToUndefined)
  @IsIn(careTypeValues, { message: 'Choose the type of care you need' })
  careType?: CareType;

  @ApiPropertyOptional({ description: 'District id - required when no caregiver is chosen' })
  @ValidateIf((o: CreateCareRequestDto) => !o.caregiverPublicId || o.districtId !== undefined)
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsInt({ message: 'Choose the district where care is needed' })
  @Min(1, { message: 'Choose the district where care is needed' })
  districtId?: number;

  @ApiPropertyOptional({ description: 'City id, within the district' })
  @IsOptional()
  @Transform(blankToUndefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId?: number;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'When care should start' })
  @IsOptional()
  @Transform(trimToUndefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Enter a valid start date' })
  desiredStartDate?: string;
}
