import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(255)
  email: string;
}

export class ResetTokenDto {
  @ApiProperty()
  @IsString()
  @MaxLength(128)
  token: string;
}

export class ResetPasswordWithTokenDto extends ResetTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for the password' })
  @MaxLength(128, { message: 'Use at most 128 characters for the password' })
  newPassword: string;
}

/** An admin's password help for a caregiver or client: email them a link, or set one. */
export class AdminPasswordResetDto {
  @ApiProperty({ enum: ['SEND_LINK', 'SET_PASSWORD'] })
  @IsIn(['SEND_LINK', 'SET_PASSWORD'])
  mode: 'SEND_LINK' | 'SET_PASSWORD';

  @ApiPropertyOptional({ description: 'Required for SET_PASSWORD' })
  // Checked when given; a missing one is reported once, by the service.
  @ValidateIf((o: AdminPasswordResetDto) => o.mode === 'SET_PASSWORD' && o.newPassword !== undefined && o.newPassword !== null)
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters for the password' })
  @MaxLength(128, { message: 'Use at most 128 characters for the password' })
  newPassword?: string;
}
