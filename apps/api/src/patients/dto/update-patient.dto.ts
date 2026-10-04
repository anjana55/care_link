import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { genderEnum } from '../../database/schema/caregivers.schema';
import { TextField } from '../../common/validation/text-field.validator';

/**
 * A staff edit of a client's details.
 *
 * Hand-written rather than `PartialType(CreatePatientDto)` because no such
 * create path exists: clients self-register through POST /auth/register-patient
 * and its WhatsApp twin, and RegisterPatientDto is that public contract - it
 * carries `password` and `consentAccepted`, neither of which belongs on a staff
 * PATCH. UpdateUserDto is the house precedent for this shape.
 *
 * Messages are spelled out rather than left to class-validator's defaults
 * ("permanentAddress must be a string") because this form renders the server's
 * rejection verbatim; each one is matched one-for-one by the client-side Zod
 * schema, so a rejection reads the same in the browser and here.
 *
 * districtId/cityId are accepted as ids. district/city/province/postalCode are
 * NOT: the first two are resolved and validated by the service (a city must
 * belong to its district) and the rest are display caches it writes. Accepting
 * them from a client is exactly how those caches drift from the ids that search
 * actually matches on.
 */
export class UpdatePatientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @TextField({
    min: 2,
    requiredMessage: 'Full name is required',
    invalidMessage: 'Enter a full name of at least 2 characters',
  })
  @IsString({ message: 'Full name must be text' })
  fullName?: string;

  @ApiPropertyOptional({ description: 'Email address of the linked login account' })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  /**
   * Free text, and validated as such - deliberately NOT @IsPhoneNumber('LK'),
   * which is the LK-only constraint on the public self-registration form. The
   * column stores whatever spelling it was given (see phone.util.ts), so a
   * re-submit of the value already there has to be acceptable. @MaxLength(20)
   * matches the column width so the DTO cannot accept something MySQL would
   * truncate. Whether the number is actually *usable* is normalizePhone's call,
   * in the service - one authority for that rule, not two that can disagree.
   */
  @ApiPropertyOptional({ description: 'Contact number, in any format' })
  @IsOptional()
  @IsString({ message: 'Phone must be text' })
  @MaxLength(20, { message: 'Phone number is too long' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Address must be text' })
  permanentAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'NIC must be text' })
  @MaxLength(20, { message: 'NIC must be 20 characters or fewer' })
  nic?: string;

  /**
   * 'YYYY-MM-DD' or omit/null. An empty string is rejected rather than treated
   * as a clear, so the web form must serialise a blank date input to null or
   * leave it out entirely.
   */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString({}, { message: 'Enter a valid date of birth' })
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: genderEnum })
  @IsOptional()
  @IsEnum(genderEnum, { message: 'Gender must be MALE, FEMALE or OTHER' })
  gender?: (typeof genderEnum)[number];

  @ApiPropertyOptional({ description: 'District id from the locations reference data' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'District id must be a number' })
  @Min(1, { message: 'District id must be a valid district' })
  districtId?: number;

  @ApiPropertyOptional({ description: 'City id from the locations reference data' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'City id must be a number' })
  @Min(1, { message: 'City id must be a valid city' })
  cityId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ message: 'Notes must be text' })
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;
}