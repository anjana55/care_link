import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CreateEmployerEnquiryDto, UpdateEmployerAccountDto } from './international.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value);

/**
 * An enquiry staff record themselves - one that came in by phone, email or at
 * a fair. The same details as the public form, without its bot trap and
 * consent box: staff only record an employer who asked to be contacted.
 */
export class StaffEnquiryDto extends OmitType(CreateEmployerEnquiryDto, ['talentSlug', 'consent', 'website2', 'language'] as const) {
  /** The employer account it belongs to, if they have one. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  employerId?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000)
  staffNote?: string | null;
}

/** An admin opening an employer account for an organisation, e.g. one met in person. */
export class AdminCreateEmployerDto extends OmitType(UpdateEmployerAccountDto, [] as const) {
  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(255)
  email!: string;

  /** Default true: email them a link to set their password (valid 24 hours). */
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean()
  sendPasswordLink?: boolean;

  /** Default VERIFIED: an admin is creating it, so the organisation is known. */
  @ApiPropertyOptional({ enum: ['VERIFIED', 'PENDING_REVIEW'] }) @IsOptional() @IsIn(['VERIFIED', 'PENDING_REVIEW'])
  status?: 'VERIFIED' | 'PENDING_REVIEW';
}

/** An admin correcting an employer account: any organisation detail, and the sign-in email. */
export class AdminEditEmployerDto extends OmitType(UpdateEmployerAccountDto, [] as const) {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsEmail() @MaxLength(255)
  email?: string;
}

/** Staff signing a caregiver up for a programme (they asked in person, or by phone). */
export class EnrolCaregiverDto {
  @ApiProperty() @IsUUID()
  caregiverId!: string;

  @ApiPropertyOptional({ enum: ['INTERESTED', 'ENROLLED'], default: 'ENROLLED' }) @IsOptional() @IsIn(['INTERESTED', 'ENROLLED'])
  status?: 'INTERESTED' | 'ENROLLED';
}
