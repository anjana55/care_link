import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType } from '@nestjs/swagger';
import { Equals, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { CreateCaregiverDto } from '../../caregivers/dto/create-caregiver.dto';
import { PatientProfileDto } from './patient-profile.dto';
import { TextField } from '../../common/validation/text-field.validator';
import { whatsappOtpPurposeEnum, type WhatsappOtpPurpose } from '../../database/schema';

const WHATSAPP_NUMBER_HELP = 'The number the code is sent to. Sri Lankan numbers may be written 0771234567 or +94771234567';

/**
 * Caregiver self-registration for someone without an email address. Same
 * personal-information requirements as the email flow (it extends the very
 * same DTO), but identity is a WhatsApp number instead of email + password.
 * The caregiver's `primaryPhone` defaults to that number when left blank.
 */
export class RegisterCaregiverWhatsappDto extends OmitType(CreateCaregiverDto, ['primaryPhone'] as const) {
  @ApiProperty({ description: WHATSAPP_NUMBER_HELP })
  @TextField({
    min: 7,
    max: 20,
    requiredMessage: 'WhatsApp number is required',
    invalidMessage: 'Enter a valid WhatsApp number',
  })
  @IsString({ message: 'WhatsApp number must be text' })
  whatsappNumber: string;

  @ApiProperty({ required: false, description: 'Defaults to the WhatsApp number' })
  @IsOptional()
  @IsString({ message: 'Primary phone must be text' })
  @MaxLength(32)
  primaryPhone?: string;

  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}

/**
 * Customer (patient/guardian) self-registration with a WhatsApp number. Asks for
 * the same care intake as the email flow; the WhatsApp number doubles as the
 * contact phone.
 */
export class RegisterPatientWhatsappDto extends PatientProfileDto {
  @ApiProperty()
  @IsString()
  @Length(2, 255)
  fullName: string;

  @ApiProperty({ description: WHATSAPP_NUMBER_HELP })
  @TextField({
    min: 7,
    max: 20,
    requiredMessage: 'WhatsApp number is required',
    invalidMessage: 'Enter a valid WhatsApp number',
  })
  @IsString({ message: 'WhatsApp number must be text' })
  whatsappNumber: string;

  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}

/** Staff have no WhatsApp sign-in, so only the two self-registered kinds of account. */
export const WHATSAPP_PORTALS = ['caregiver', 'customer'] as const;

export class RequestWhatsappOtpDto {
  @ApiProperty({ description: WHATSAPP_NUMBER_HELP })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiProperty({ enum: whatsappOtpPurposeEnum, description: 'REGISTER re-sends the sign-up code; LOGIN and RECOVERY are for existing accounts' })
  @IsIn(whatsappOtpPurposeEnum)
  purpose: WhatsappOtpPurpose;

  @ApiPropertyOptional({
    enum: WHATSAPP_PORTALS,
    description:
      'Which sign-in screen this is. A number that belongs to the other kind of account is treated as not registered (no code is sent, and a code cannot be verified).',
  })
  @IsOptional()
  @IsIn(WHATSAPP_PORTALS)
  portal?: (typeof WHATSAPP_PORTALS)[number];
}

export class VerifyWhatsappOtpDto extends RequestWhatsappOtpDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{4,8}$/, { message: 'Enter the numeric code from WhatsApp' })
  code: string;
}
