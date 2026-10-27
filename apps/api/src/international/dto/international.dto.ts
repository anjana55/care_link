import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  COUNTRY_CODES,
  MAX_TARGET_COUNTRIES,
  SHARED_PROFILE_LIMITS,
  careTypeValues,
  employerEnquiryStatusValues,
  employerStatusValues,
  candidateStatusValues,
  type CandidateStatus,
  type EmployerStatus,
  employerTypeValues,
  LOCALES,
  trainingCategoryValues,
  trainingEnrolmentStatusValues,
  trainingFormatValues,
  visaSponsorshipValues,
  type CareType,
  type CountryCode,
  type EmployerEnquiryStatus,
  type EmployerType,
  type Locale,
  type TrainingCategory,
  type TrainingEnrolmentStatus,
  type TrainingFormat,
  type VisaSponsorship,
} from '@care-platform/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};
const blankToNull = ({ value }: { value: unknown }) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

// --- employer enquiries ----------------------------------------------------

export class CreateEmployerEnquiryDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  organisationName!: string;

  @ApiProperty({ enum: employerTypeValues }) @IsIn(employerTypeValues)
  organisationType!: EmployerType;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2' }) @IsIn(COUNTRY_CODES)
  country!: CountryCode;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150)
  contactName!: string;

  @ApiProperty() @Transform(trim) @IsEmail() @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ description: 'International format, e.g. +81 90 1234 5678' })
  @IsOptional() @Transform(blankToUndefined) @IsString() @Matches(/^\+?[0-9 ()-]{6,30}$/)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(255)
  website?: string;

  @ApiProperty({ minimum: 1, maximum: 500 }) @Type(() => Number) @IsInt() @Min(1) @Max(500)
  rolesCount!: number;

  @ApiProperty({ enum: careTypeValues, isArray: true })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(careTypeValues.length) @IsIn(careTypeValues, { each: true })
  careSettings!: CareType[];

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(255)
  languages?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  startTimeframe?: string;

  @ApiProperty({ enum: visaSponsorshipValues }) @IsIn(visaSponsorshipValues)
  visaSponsorship!: VisaSponsorship;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(3000)
  message?: string;

  @ApiPropertyOptional({ description: 'Slug of the shared profile the enquiry was sent from' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9]{6,24}$/)
  talentSlug?: string;

  @ApiProperty({ description: 'Must be true: the employer agrees to be contacted and to the privacy notice' })
  @Equals(true)
  consent!: true;

  @ApiPropertyOptional({ enum: LOCALES }) @IsOptional() @IsIn(LOCALES)
  language?: Locale;

  /** Honeypot. Hidden from people; bots fill every field. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  website2?: string;
}

export class EmployerEnquiryQueryDto {
  @ApiPropertyOptional({ enum: [...employerEnquiryStatusValues, 'open'] })
  @IsOptional() @IsIn([...employerEnquiryStatusValues, 'open'])
  status?: EmployerEnquiryStatus | 'open';

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: "Only this employer account's enquiries" }) @IsOptional() @IsUUID()
  employerId?: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

export class UpdateEmployerEnquiryDto {
  @ApiPropertyOptional({ enum: employerEnquiryStatusValues }) @IsOptional() @IsIn(employerEnquiryStatusValues)
  status?: EmployerEnquiryStatus;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000)
  staffNote?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  placementFeeAmount?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'ISO 4217, e.g. USD' })
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @Matches(/^[A-Z]{3}$/)
  placementFeeCurrency?: string | null;
}

// --- overseas readiness ----------------------------------------------------

export class UpdateOverseasReadinessDto {
  @ApiProperty() @IsBoolean()
  openToOverseas!: boolean;

  @ApiProperty({ isArray: true }) @IsArray() @ArrayMaxSize(MAX_TARGET_COUNTRIES) @IsIn(COUNTRY_CODES, { each: true })
  targetCountries!: CountryCode[];

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  passportHeld?: boolean | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  passportExpiry?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  availableFrom?: string | null;
}

// --- training --------------------------------------------------------------

export class TrainingProgrammeDto {
  @ApiProperty({ enum: trainingCategoryValues }) @IsIn(trainingCategoryValues)
  category!: TrainingCategory;

  @ApiProperty({ enum: trainingFormatValues }) @IsIn(trainingFormatValues)
  format!: TrainingFormat;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  titleEn!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  titleSi?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200)
  titleTa?: string | null;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(4000)
  descriptionEn!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(4000)
  descriptionSi?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(4000)
  descriptionTa?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100)
  duration?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  feeLkr?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  nextStartDate?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(100)
  passMark?: number | null;
}

export class UpdateTrainingEnrolmentDto {
  @ApiProperty({ enum: trainingEnrolmentStatusValues }) @IsIn(trainingEnrolmentStatusValues)
  status!: TrainingEnrolmentStatus;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(100)
  progressPercent?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(100)
  score?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  completedAt?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  staffNote?: string | null;
}

// --- shared profiles -------------------------------------------------------

export class UpdateSharedProfileDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(SHARED_PROFILE_LIMITS.firstName)
  // A first name, not a full name: letters (any script), spaces, hyphens, apostrophes and dots.
  @Matches(/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u, { message: 'Please enter a first name using letters only.' })
  firstName!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(SHARED_PROFILE_LIMITS.headline)
  headline?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(SHARED_PROFILE_LIMITS.bio)
  bio?: string | null;
}

export class ShareProfileDto {
  @ApiProperty({ description: 'The caregiver agrees to their first name and photo being shown publicly' })
  @Equals(true)
  consent!: true;

  @ApiProperty({ description: 'The consent wording version the caregiver was shown' }) @IsString() @MaxLength(20)
  consentVersion!: string;
}

export class ReviewSharedProfileDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(500)
  note?: string;
}

export class SharedProfileQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'all'] })
  @IsOptional() @IsIn(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'all'])
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'all';
}

export class TalentQueryDto {
  @ApiPropertyOptional({ enum: LOCALES }) @IsOptional() @IsIn(LOCALES)
  locale?: Locale;

  @ApiPropertyOptional({ description: 'Only caregivers who list this destination' }) @IsOptional() @IsIn(COUNTRY_CODES)
  country?: CountryCode;

  @ApiPropertyOptional({ description: 'Only caregivers who speak this language (id from /public/meta/languages)' }) @IsOptional() @IsUUID()
  languageId?: string;

  @ApiPropertyOptional({ enum: trainingCategoryValues, description: 'Only caregivers who completed a course in this category' })
  @IsOptional() @IsIn(trainingCategoryValues)
  training?: TrainingCategory;

  @ApiPropertyOptional({ description: 'Only caregivers the platform has verified' })
  @IsOptional() @Transform(({ value }) => value === true || value === 'true' || value === '1') @IsBoolean()
  verifiedOnly?: boolean;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 12 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48)
  pageSize?: number;
}

// --- employer accounts (Phase 2) --------------------------------------------

/** A signed-in employer's enquiry. Organisation and contact come from the account. */
export class EmployerAccountEnquiryDto {
  @ApiPropertyOptional({ description: 'Where the caregivers would work, if not the account country' }) @IsOptional() @IsIn(COUNTRY_CODES)
  country?: CountryCode;

  @ApiProperty({ minimum: 1, maximum: 500 }) @Type(() => Number) @IsInt() @Min(1) @Max(500)
  rolesCount!: number;

  @ApiProperty({ enum: careTypeValues, isArray: true })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(careTypeValues.length) @IsIn(careTypeValues, { each: true })
  careSettings!: CareType[];

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(255)
  languages?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  startTimeframe?: string;

  @ApiProperty({ enum: visaSponsorshipValues }) @IsIn(visaSponsorshipValues)
  visaSponsorship!: VisaSponsorship;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(3000)
  message?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z0-9]{6,24}$/)
  talentSlug?: string;
}

export class UpdateEmployerAccountDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200)
  organisationName?: string;

  @ApiPropertyOptional({ enum: employerTypeValues }) @IsOptional() @IsIn(employerTypeValues)
  organisationType?: EmployerType;

  @ApiPropertyOptional() @IsOptional() @IsIn(COUNTRY_CODES)
  country?: CountryCode;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150)
  contactName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @Matches(/^\+?[0-9 ()-]{6,30}$/, { message: 'Please enter the number with its country code, e.g. +81 90 1234 5678.' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(255)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100)
  companyRegistrationNumber?: string | null;
}

export class EmployerQueryDto {
  @ApiPropertyOptional({ enum: [...employerStatusValues, 'all'] }) @IsOptional() @IsIn([...employerStatusValues, 'all'])
  status?: EmployerStatus | 'all';
}

export class ReviewEmployerDto {
  @ApiProperty({ enum: ['VERIFY', 'REJECT', 'SUSPEND'] }) @IsIn(['VERIFY', 'REJECT', 'SUSPEND'])
  decision!: 'VERIFY' | 'REJECT' | 'SUSPEND';

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(500)
  note?: string;
}

export class ProposeCandidateDto {
  @ApiProperty() @IsUUID()
  caregiverId!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(1000)
  messageToEmployer?: string;
}

export class UpdateCandidateDto {
  @ApiPropertyOptional({ enum: candidateStatusValues }) @IsOptional() @IsIn(candidateStatusValues)
  status?: CandidateStatus;

  @ApiPropertyOptional({ nullable: true, description: 'ISO date-time' }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString()
  interviewAt?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  messageToEmployer?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  staffNote?: string | null;
}

export class InterviewRequestDto {
  @ApiProperty() @IsUUID()
  enquiryId!: string;

  @ApiProperty() @IsString() @Matches(/^[a-z0-9]{6,24}$/)
  talentSlug!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(1000)
  message?: string;
}

export class EmployerCandidateActionDto {
  @ApiProperty({ enum: ['REQUEST_INTERVIEW', 'SELECT', 'DECLINE'] }) @IsIn(['REQUEST_INTERVIEW', 'SELECT', 'DECLINE'])
  action!: 'REQUEST_INTERVIEW' | 'SELECT' | 'DECLINE';

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(1000)
  message?: string;
}

export class TalentPoolQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(COUNTRY_CODES)
  country?: CountryCode;

  @ApiPropertyOptional({ description: 'Minimum readiness items done' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10)
  minReady?: number;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  search?: string;
}
