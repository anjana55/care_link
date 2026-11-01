import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { TextField } from '../../common/validation/text-field.validator';

/**
 * The email-and-password choice at the end of caregiver sign-up
 * (POST /auth/register-caregiver/unified/password): the pending token from the
 * form, and the address and password to sign in with.
 */
export class SetSignupPasswordDto {
  @ApiProperty({ description: 'The pendingToken returned by POST /auth/register-caregiver/unified' })
  @IsString()
  pendingToken: string;

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
}
