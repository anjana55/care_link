import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType } from '@nestjs/swagger';
import { Equals, IsEmail, IsOptional, IsString } from 'class-validator';
import { CreateCaregiverDto } from '../../caregivers/dto/create-caregiver.dto';
import { TextField } from '../../common/validation/text-field.validator';

/**
 * The unified caregiver registration: one phone number (mandatory), an email
 * address (optional), and every personal-information field both the email and
 * WhatsApp sign-up routes ask for.
 *
 * `primaryPhone` is omitted rather than reused. CreateCaregiverDto calls it the
 * caregiver's primary phone, and the WhatsApp DTO layered a *second* number on
 * top (`whatsappNumber`) that defaulted to it - so that form asked for one
 * number twice. Here there is exactly one input, named `phone`, which the
 * service writes to both users.phone and caregivers.primaryPhone. Naming it
 * "phone" rather than "whatsapp number" is deliberate: the number is how staff
 * reach the caregiver, whatever they sign in with.
 *
 * No password. The caregiver secures the account afterwards with Google,
 * Microsoft or Facebook (see SocialAuthController); an email address here is
 * what that provider sign-in has to agree with.
 */
export class RegisterCaregiverUnifiedDto extends OmitType(CreateCaregiverDto, ['primaryPhone'] as const) {
  @ApiProperty({
    description: "The caregiver's phone number - how staff reach them, and how they sign in",
    example: '0771234567',
  })
  @TextField({
    min: 9,
    requiredMessage: 'Phone number is required',
    invalidMessage: 'Enter a valid phone number with at least 9 digits',
  })
  @IsString({ message: 'Phone number must be text' })
  phone: string;

  @ApiPropertyOptional({
    description:
      'Optional. Must match the address they later verify with Google, Microsoft or Facebook.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}