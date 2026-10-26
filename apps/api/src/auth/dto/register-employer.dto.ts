import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { COUNTRY_CODES, employerTypeValues, type CountryCode, type EmployerType } from '@care-platform/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/**
 * Public sign-up for an overseas employer. Creates an unverified EMPLOYER
 * login and its organisation; staff verify the organisation before the
 * account can ask for interviews.
 */
export class RegisterEmployerDto {
  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(255)
  email!: string;

  @ApiProperty({ description: 'Minimum 8 characters' }) @IsString() @MinLength(8) @MaxLength(200)
  password!: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150)
  contactName!: string;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  organisationName!: string;

  @ApiProperty({ enum: employerTypeValues }) @IsIn(employerTypeValues)
  organisationType!: EmployerType;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' }) @IsIn(COUNTRY_CODES)
  country!: CountryCode;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @Matches(/^\+?[0-9 ()-]{6,30}$/, { message: 'Please enter the number with its country code, e.g. +81 90 1234 5678.' })
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(255)
  website?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  companyRegistrationNumber?: string;

  @ApiProperty({ description: 'Must be true: the employer accepts the terms and privacy notice' })
  @Equals(true, { message: 'You must accept the data processing consent to register' })
  consent!: true;
}
