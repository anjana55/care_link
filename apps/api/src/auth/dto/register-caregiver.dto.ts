import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Equals } from 'class-validator';
import { CreateCaregiverDto } from '../../caregivers/dto/create-caregiver.dto';
import { TextField } from '../../common/validation/text-field.validator';

/**
 * Everything CreateCaregiverDto already requires (personal info), plus the
 * identity fields needed to create the caregiver's own login. Deliberately
 * does NOT expose `status` or any verification field - those aren't on
 * CreateCaregiverDto either, so extending it keeps this DTO just as safe.
 */
export class RegisterCaregiverDto extends CreateCaregiverDto {
  // One message for both a blank and a malformed address: both are fixed by
  // typing a valid email, and a second "Email is required" on top would just
  // repeat it.
  @ApiProperty()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @ApiProperty({ description: 'Minimum 8 characters' })
  @TextField({
    min: 8,
    requiredMessage: 'Password is required',
    invalidMessage: 'Password must be at least 8 characters',
  })
  @IsString({ message: 'Password must be text' })
  password: string;

  // @Equals alone is enough: @IsBoolean would fail alongside it for an omitted
  // field and repeat the same sentence twice.
  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}
