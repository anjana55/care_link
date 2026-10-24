import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { CARE_REQUEST_MESSAGE_MAX, careTypeValues, type CareType } from '@care-platform/shared';
import { PatientProfileDto } from '../../auth/dto/patient-profile.dto';
import { TextField } from '../../common/validation/text-field.validator';
import { careRequestLanguageEnum, type CareRequestLanguage } from '../../database/schema';

const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/**
 * A caller who is not yet a client. The same intake the public sign-up asks
 * for (PatientProfileDto), plus who they are and a number to reach them on.
 * There is no password: they can sign in later with a WhatsApp code sent to
 * this number.
 */
export class PhoneClientDto extends PatientProfileDto {
  @ApiProperty()
  @TextField({ min: 2, max: 255, requiredMessage: 'Full name is required', invalidMessage: 'Enter a valid full name' })
  @IsString({ message: 'Full name must be text' })
  fullName: string;

  @ApiProperty({ example: '0771234567', description: "The caller's mobile number - becomes their WhatsApp sign-in number" })
  @Matches(/^\+?[\d\s\-()]{7,20}$/, { message: 'Enter a valid phone number' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToUndefined)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(255)
  email?: string;

  @ApiProperty({ description: 'The caller agreed, on the call, to CareLink storing their details to arrange care' })
  @Equals(true, { message: 'Confirm the caller agreed to us keeping their details' })
  consentConfirmed: boolean;
}

/**
 * POST /care-requests - a request staff take down during a phone call.
 * Exactly one of `patientId` (an existing client) or `newClient` (a first-time
 * caller). The caregiver is optional: staff can log the need now and match later.
 */
export class CreateStaffCareRequestDto {
  @ApiPropertyOptional({ description: 'An existing client' })
  @ValidateIf((o: CreateStaffCareRequestDto) => !o.newClient)
  @IsUUID('all', { message: 'Choose the client, or add them as a new caller' })
  patientId?: string;

  @ApiPropertyOptional({ type: PhoneClientDto })
  @ValidateIf((o: CreateStaffCareRequestDto) => !o.patientId)
  @ValidateNested()
  @Type(() => PhoneClientDto)
  newClient?: PhoneClientDto;

  @ApiPropertyOptional({ description: 'Internal caregiver id; omit to match later' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;

  @ApiPropertyOptional({ enum: careTypeValues, description: 'The type of care the caller needs, if they said' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? undefined : value))
  @IsIn(careTypeValues, { message: 'Choose a valid type of care' })
  careType?: CareType;

  @ApiPropertyOptional({ maxLength: CARE_REQUEST_MESSAGE_MAX, description: 'What the caller asked for, in their words' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(CARE_REQUEST_MESSAGE_MAX, { message: 'Your message is too long - please keep it under 1000 characters' })
  message?: string;

  @ApiProperty({ enum: careRequestLanguageEnum, description: "The language the caller's updates are sent in" })
  @IsIn(careRequestLanguageEnum, { message: 'Choose the language for updates' })
  language: CareRequestLanguage;
}

export class SetCareRequestCaregiverDto {
  @ApiProperty({ nullable: true, description: 'Internal caregiver id, or null to detach' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId: string | null;
}
