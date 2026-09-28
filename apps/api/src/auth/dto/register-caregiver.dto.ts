import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsString, MinLength, Equals } from 'class-validator';
import { CreateCaregiverDto } from '../../caregivers/dto/create-caregiver.dto';

/**
 * Everything CreateCaregiverDto already requires (personal info), plus the
 * identity fields needed to create the caregiver's own login. Deliberately
 * does NOT expose `status` or any verification field - those aren't on
 * CreateCaregiverDto either, so extending it keeps this DTO just as safe.
 */
export class RegisterCaregiverDto extends CreateCaregiverDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Minimum 8 characters' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}
