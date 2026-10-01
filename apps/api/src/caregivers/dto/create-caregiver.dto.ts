import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength } from 'class-validator';
import { civilStatusEnum, genderEnum } from '../../database/schema/caregivers.schema';
import { TextField } from '../../common/validation/text-field.validator';

/**
 * Validation messages are written out rather than left to class-validator's
 * defaults ("fullName must be a string"), because these strings are shown
 * verbatim to the person filling in the form. They are worded to match the
 * client-side Zod messages one for one, so a rejection reads the same whether
 * it was caught in the browser or here.
 *
 * Mandatory text fields use TextField rather than @MinLength so a blank field
 * says "is required" and a too-short one explains the rule, without both
 * firing for the same input.
 */
export class CreateCaregiverDto {
  @ApiProperty()
  @TextField({
    min: 2,
    requiredMessage: 'Full name is required',
    invalidMessage: 'Enter a full name of at least 2 characters',
  })
  @IsString({ message: 'Full name must be text' })
  fullName: string;

  @ApiProperty()
  @TextField({
    min: 5,
    requiredMessage: 'Permanent address is required',
    invalidMessage: 'Enter an address of at least 5 characters',
  })
  @IsString({ message: 'Permanent address must be text' })
  permanentAddress: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'NIC must be text' })
  @MaxLength(20, { message: 'NIC must be 20 characters or fewer' })
  nic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Passport number must be text' })
  @MaxLength(20, { message: 'Passport number must be 20 characters or fewer' })
  passportNumber?: string;

  // A date input can only ever be blank or well-formed, so a single message
  // covers both cases without needing a second "is required" constraint.
  @ApiProperty()
  @IsDateString({}, { message: 'Enter a valid date of birth' })
  dateOfBirth: string;

  @ApiProperty({ enum: genderEnum })
  @IsEnum(genderEnum, { message: 'Gender is required' })
  gender: (typeof genderEnum)[number];

  @ApiProperty({ enum: civilStatusEnum })
  @IsEnum(civilStatusEnum, { message: 'Civil status is required' })
  civilStatus: (typeof civilStatusEnum)[number];

  // @IsNumber rather than @IsInt: the column is DECIMAL(5,1) so a one-decimal
  // height is valid, and a whole-number rule would reject 63.5. class-validator
  // has no decimal-places constraint, so the scale is enforced by the column.
  @ApiPropertyOptional({ description: 'Height in inches, one decimal place' })
  @IsOptional()
  @IsNumber({}, { message: 'Height must be a number of inches' })
  @Max(120, { message: 'Height must be 120 inches or fewer' })
  heightIn?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt({ message: 'Weight must be a whole number of kilograms' })
  weightKg?: number;

  @ApiProperty()
  @TextField({
    min: 9,
    requiredMessage: 'Primary phone is required',
    invalidMessage: 'Enter a valid phone number with at least 9 digits',
  })
  @IsString({ message: 'Primary phone must be text' })
  primaryPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Secondary phone must be text' })
  secondaryPhone?: string;

  @ApiProperty()
  @TextField({
    min: 2,
    requiredMessage: 'Emergency contact name is required',
    invalidMessage: 'Enter a name of at least 2 characters',
  })
  @IsString({ message: 'Emergency contact name must be text' })
  emergencyContactName: string;

  @ApiProperty()
  @TextField({
    min: 9,
    requiredMessage: 'Emergency contact number is required',
    invalidMessage: 'Enter a valid phone number with at least 9 digits',
  })
  @IsString({ message: 'Emergency contact number must be text' })
  emergencyContactNumber: string;

  @ApiProperty()
  @TextField({
    min: 2,
    requiredMessage: 'Relationship to this contact is required',
    invalidMessage: 'Describe how you are related to this contact',
  })
  @IsString({ message: 'Relationship must be text' })
  emergencyContactRelationship: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Police division must be text' })
  policeDivision?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Police station must be text' })
  policeStation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'District must be text' })
  @MaxLength(100, { message: 'District must be 100 characters or fewer' })
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'City must be text' })
  @MaxLength(100, { message: 'City must be 100 characters or fewer' })
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Postal code must be text' })
  @MaxLength(20, { message: 'Postal code must be 20 characters or fewer' })
  postalCode?: string;
}
