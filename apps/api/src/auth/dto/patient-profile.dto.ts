import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { TextField } from '../../common/validation/text-field.validator';
import {
  caregiverGenderPreferenceEnum,
  careScheduleEnum,
  careStartEnum,
  contactMethodEnum,
  contactTimeEnum,
  recipientGenderEnum,
  recipientRelationshipEnum,
  registrantTypeEnum,
  type CaregiverGenderPreference,
  type CareSchedule,
  type CareStart,
  type ContactMethod,
  type ContactTime,
  type RecipientGender,
  type RecipientRelationship,
  type RegistrantType,
} from '../../database/schema';

const isGuardian = (o: PatientProfileDto) => o.registrantType === 'GUARDIAN';

/**
 * The intake half of a client (patient/guardian) registration: who needs care,
 * where, what kind, and how staff should get in touch. Shared by the email and
 * the WhatsApp sign-up DTOs so both flows demand exactly the same information.
 *
 * Everything here is mandatory for a new registration except the fields marked
 * optional. (The `patients` columns themselves are nullable only because
 * clients registered before these fields existed have none of them.)
 */
export class PatientProfileDto {
  @ApiProperty({ enum: registrantTypeEnum, description: 'SELF: the person registering needs care. GUARDIAN: they are arranging care for someone else' })
  @IsIn(registrantTypeEnum, { message: 'Choose who needs care' })
  registrantType: RegistrantType;

  @ApiPropertyOptional({ description: 'Name of the person needing care. Required when registrantType is GUARDIAN; ignored for SELF' })
  @ValidateIf(isGuardian)
  @TextField({ min: 2, max: 255, requiredMessage: 'Name of the person needing care is required', invalidMessage: 'Enter a valid name for the person needing care' })
  @IsString({ message: 'Name of the person needing care must be text' })
  recipientName?: string;

  @ApiPropertyOptional({ enum: recipientRelationshipEnum, description: 'Required when registrantType is GUARDIAN; ignored for SELF' })
  @ValidateIf(isGuardian)
  @IsIn(recipientRelationshipEnum, { message: 'Choose your relationship to the person needing care' })
  recipientRelationship?: RecipientRelationship;

  @ApiProperty({ description: 'Age in years of the person needing care', minimum: 0, maximum: 120 })
  @IsInt({ message: 'Enter the age of the person needing care' })
  @Min(0, { message: 'Enter a valid age' })
  @Max(120, { message: 'Enter a valid age' })
  recipientAge: number;

  @ApiProperty({ enum: recipientGenderEnum })
  @IsIn(recipientGenderEnum, { message: 'Choose the gender of the person needing care' })
  recipientGender: RecipientGender;

  @ApiPropertyOptional({ description: 'A second number staff can try if the first is unreachable' })
  @IsOptional()
  @Matches(/^\+?[\d\s\-()]{7,20}$/, { message: 'Enter a valid alternate phone number' })
  alternatePhone?: string;

  @ApiProperty({ enum: contactMethodEnum, description: 'How staff should reach the client first. EMAIL is only accepted for email accounts' })
  @IsIn(contactMethodEnum, { message: 'Choose how we should contact you' })
  preferredContactMethod: ContactMethod;

  @ApiPropertyOptional({ enum: contactTimeEnum, description: 'Defaults to ANYTIME' })
  @IsOptional()
  @IsIn(contactTimeEnum, { message: 'Choose a valid contact time' })
  preferredContactTime?: ContactTime;

  @ApiProperty({ description: 'District where care is needed (districts.id)' })
  @IsInt({ message: 'Choose the district where care is needed' })
  @Min(1, { message: 'Choose the district where care is needed' })
  districtId: number;

  @ApiProperty({ description: 'City where care is needed (cities.id); must belong to districtId' })
  @IsInt({ message: 'Choose the city where care is needed' })
  @Min(1, { message: 'Choose the city where care is needed' })
  cityId: number;

  @ApiPropertyOptional({ description: 'Street address where care is needed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  careAddress?: string;

  @ApiProperty({ description: 'Short description of the care needed (conditions, daily help, anything a caregiver should know)' })
  @TextField({ min: 10, max: 1000, requiredMessage: 'Describe the care needed', invalidMessage: 'Describe the care needed in at least 10 characters' })
  @IsString({ message: 'Care needs must be text' })
  careNeeds: string;

  @ApiProperty({ enum: careScheduleEnum })
  @IsIn(careScheduleEnum, { message: 'Choose when care is needed' })
  careSchedule: CareSchedule;

  @ApiProperty({ enum: careStartEnum })
  @IsIn(careStartEnum, { message: 'Choose when care should start' })
  careStart: CareStart;

  @ApiPropertyOptional({ enum: caregiverGenderPreferenceEnum, description: 'Defaults to NO_PREFERENCE' })
  @IsOptional()
  @IsIn(caregiverGenderPreferenceEnum, { message: 'Choose a valid caregiver gender preference' })
  preferredCaregiverGender?: CaregiverGenderPreference;
}
