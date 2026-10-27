import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  ASSESSMENT_LIMITS,
  CONTACT_ABROAD_LIMITS,
  COUNTRY_CODES,
  CURRENCY_CODES,
  INTERVIEW_LIMITS,
  OFFER_LIMITS,
  WELFARE_LIMITS,
  accommodationValues,
  assessmentKindValues,
  assessmentProviderValues,
  cefrLevelValues,
  flightsPaidByValues,
  interviewModeValues,
  interviewStatusValues,
  offerStatusValues,
  salaryPeriodValues,
  welfareCategoryValues,
  welfareSeverityValues,
  welfareStatusValues,
  type Accommodation,
  type AssessmentKind,
  type AssessmentProvider,
  type CefrLevel,
  type CountryCode,
  type CurrencyCode,
  type FlightsPaidBy,
  type InterviewMode,
  type InterviewStatus,
  type OfferStatus,
  type SalaryPeriod,
  type WelfareCategory,
  type WelfareSeverity,
  type WelfareStatus,
} from '@care-platform/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => {
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// --- training -----------------------------------------------------------------------

export class RevokeCertificateDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

// --- assessments ----------------------------------------------------------------------

export class AssessmentDto {
  @ApiProperty({ enum: assessmentKindValues }) @IsIn(assessmentKindValues)
  kind!: AssessmentKind;

  @ApiProperty({ enum: assessmentProviderValues }) @IsIn(assessmentProviderValues)
  provider!: AssessmentProvider;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(ASSESSMENT_LIMITS.title)
  title!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(ASSESSMENT_LIMITS.score)
  score?: string | null;

  @ApiPropertyOptional({ enum: cefrLevelValues, nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsIn(cefrLevelValues)
  cefrLevel?: CefrLevel | null;

  @ApiProperty() @IsDateString({ strict: true })
  takenOn!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  validUntil?: string | null;

  /** Staff only; ignored when a caregiver sends it. */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(ASSESSMENT_LIMITS.note)
  note?: string | null;
}

export class VerifyAssessmentDto {
  @ApiProperty() @IsBoolean()
  verified!: boolean;
}

export class StaffAssessmentQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'verified', 'all'] }) @IsOptional() @IsIn(['pending', 'verified', 'all'])
  status?: 'pending' | 'verified' | 'all';

  @ApiPropertyOptional() @IsOptional() @IsString()
  caregiverId?: string;
}

// --- interviews ---------------------------------------------------------------------------

export class InterviewDto {
  /** ISO 8601 with an offset or Z. */
  @ApiProperty() @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'Give the interview time with its time zone.' })
  scheduledAt!: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(10) @Max(240)
  durationMinutes!: number;

  @ApiProperty({ enum: interviewModeValues }) @IsIn(interviewModeValues)
  mode!: InterviewMode;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'The meeting link must start with https://' })
  @MaxLength(INTERVIEW_LIMITS.link)
  meetingLink?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(INTERVIEW_LIMITS.location)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(INTERVIEW_LIMITS.instructions)
  instructions?: string | null;
}

export class UpdateInterviewDto {
  @ApiPropertyOptional() @IsOptional() @IsISO8601({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'Give the interview time with its time zone.' })
  scheduledAt?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(240)
  durationMinutes?: number;

  @ApiPropertyOptional({ enum: interviewModeValues }) @IsOptional() @IsIn(interviewModeValues)
  mode?: InterviewMode;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'The meeting link must start with https://' })
  @MaxLength(INTERVIEW_LIMITS.link)
  meetingLink?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(INTERVIEW_LIMITS.location)
  location?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(INTERVIEW_LIMITS.instructions)
  instructions?: string | null;

  @ApiPropertyOptional({ enum: interviewStatusValues }) @IsOptional() @IsIn(interviewStatusValues)
  status?: InterviewStatus;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(INTERVIEW_LIMITS.reason)
  cancelReason?: string | null;
}

export class InterviewFeedbackDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(INTERVIEW_LIMITS.feedback)
  feedback!: string;
}

export class InterviewQueryDto {
  @ApiPropertyOptional({ enum: ['upcoming', 'past', 'all'] }) @IsOptional() @IsIn(['upcoming', 'past', 'all'])
  when?: 'upcoming' | 'past' | 'all';
}

// --- offers -----------------------------------------------------------------------------------

export class OfferDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(OFFER_LIMITS.jobTitle)
  jobTitle!: string;

  @ApiProperty({ enum: COUNTRY_CODES }) @Transform(upper) @IsIn(COUNTRY_CODES)
  country!: CountryCode;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(OFFER_LIMITS.city)
  city?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  startDate?: string | null;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(120)
  contractMonths!: number;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(84)
  hoursPerWeek!: number;

  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9_999_999)
  salaryAmount!: number;

  @ApiProperty({ enum: CURRENCY_CODES }) @Transform(upper) @IsIn(CURRENCY_CODES)
  salaryCurrency!: CurrencyCode;

  @ApiProperty({ enum: salaryPeriodValues }) @IsIn(salaryPeriodValues)
  salaryPeriod!: SalaryPeriod;

  @ApiProperty({ enum: accommodationValues }) @IsIn(accommodationValues)
  accommodation!: Accommodation;

  @ApiProperty() @Transform(toBool) @IsBoolean()
  mealsProvided!: boolean;

  @ApiProperty({ enum: flightsPaidByValues }) @IsIn(flightsPaidByValues)
  flightsPaidBy!: FlightsPaidBy;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(60)
  annualLeaveDays?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(12)
  probationMonths?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(OFFER_LIMITS.otherTerms)
  otherTerms?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  expiresOn?: string | null;

  /** The signer's name, typed: their signature. */
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(OFFER_LIMITS.signature)
  signatureName!: string;
}

export class ReviewOfferDto {
  @ApiProperty({ enum: ['SEND', 'RETURN'] }) @IsIn(['SEND', 'RETURN'])
  action!: 'SEND' | 'RETURN';

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(OFFER_LIMITS.reason)
  note?: string | null;
}

export class RespondOfferDto {
  @ApiProperty({ enum: ['ACCEPT', 'DECLINE'] }) @IsIn(['ACCEPT', 'DECLINE'])
  action!: 'ACCEPT' | 'DECLINE';

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(OFFER_LIMITS.signature)
  signatureName?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(OFFER_LIMITS.reason)
  reason?: string | null;
}

export class OfferQueryDto {
  @ApiPropertyOptional({ enum: [...offerStatusValues, 'open'] }) @IsOptional() @IsIn([...offerStatusValues, 'open'])
  status?: OfferStatus | 'open';
}

// --- departure and welfare ---------------------------------------------------------------------

export class UpdateChecklistItemDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  doneOn?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsDateString({ strict: true })
  dueOn?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  note?: string | null;
}

export class ContactAbroadDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(CONTACT_ABROAD_LIMITS.address)
  addressAbroad?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\+?[0-9 ()-]{6,30}$/, { message: 'Please enter a phone number, with the country code.' })
  phoneAbroad?: string | null;
}

export class WelfareReportDto {
  @ApiProperty({ enum: welfareSeverityValues }) @IsIn(welfareSeverityValues)
  severity!: WelfareSeverity;

  @ApiProperty({ enum: welfareCategoryValues }) @IsIn(welfareCategoryValues)
  category!: WelfareCategory;

  /** Optional for an SOS: the button alone is enough. */
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(WELFARE_LIMITS.message)
  message?: string;
}

export class WelfareMessageDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(WELFARE_LIMITS.message)
  body!: string;
}

export class WelfareStatusDto {
  @ApiProperty({ enum: welfareStatusValues }) @IsIn(welfareStatusValues)
  status!: WelfareStatus;
}

export class WelfareQueryDto {
  @ApiPropertyOptional({ enum: ['open', ...welfareStatusValues, 'all'] }) @IsOptional() @IsIn(['open', ...welfareStatusValues, 'all'])
  status?: 'open' | WelfareStatus | 'all';
}

// --- reports --------------------------------------------------------------------------------------

export class ReportQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true })
  to?: string;
}
