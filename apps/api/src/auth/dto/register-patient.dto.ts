import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsPhoneNumber, IsString, Length, MinLength, Equals } from 'class-validator';
import { PatientProfileDto } from './patient-profile.dto';

/**
 * Public self-registration for a patient/guardian (the person searching for
 * and hiring a caregiver, as opposed to the caregiver themselves). Mirrors
 * RegisterCaregiverDto's shape - identity fields for the login, plus the
 * small amount of profile data the `patients` table actually holds today
 * (see patients.schema.ts) - identity and contact here, the care intake
 * (who/where/what/when) inherited from PatientProfileDto.
 */
export class RegisterPatientDto extends PatientProfileDto {
  @ApiProperty()
  @IsString()
  @Length(2, 255)
  fullName: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ description: 'Sri Lankan mobile/landline number staff can reach the client on' })
  @IsPhoneNumber('LK')
  phone: string;

  @ApiProperty({ description: 'Minimum 8 characters' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: 'Must be true - explicit consent to data processing, required at self-registration' })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consentAccepted: boolean;
}
