import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CARE_REQUEST_MESSAGE_MAX } from '@care-platform/shared';

const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** POST /me/care-requests - the client names the caregiver by public id only. */
export class CreateCareRequestDto {
  @ApiProperty({ description: "The caregiver's public id, as shown on the public profile" })
  @IsUUID('all', { message: 'Choose a caregiver to contact' })
  caregiverPublicId: string;

  @ApiPropertyOptional({ maxLength: CARE_REQUEST_MESSAGE_MAX, description: 'Anything the client wants staff to know. Seen by staff only.' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(CARE_REQUEST_MESSAGE_MAX, { message: 'Your message is too long - please keep it under 1000 characters' })
  message?: string;
}
