import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  COUNTRY_CODES,
  CURRENCY_CODES,
  VACANCY_LIMITS,
  careTypeValues,
  checkinOutcomeValues,
  englishLevelValues,
  placementPaymentMethodValues,
  placementStatusValues,
  salaryPeriodValues,
  vacancyStatusValues,
  visaSponsorshipValues,
  type CareType,
  type CheckinOutcome,
  type CountryCode,
  type CurrencyCode,
  type EnglishLevel,
  type PlacementPaymentMethod,
  type PlacementStatus,
  type SalaryPeriod,
  type VacancyApplicationStatus,
  type VacancyStatus,
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
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- vacancies --------------------------------------------------------------------

export class VacancyDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(VACANCY_LIMITS.title)
  title!: string;

  @ApiProperty({ enum: COUNTRY_CODES }) @IsIn(COUNTRY_CODES)
  country!: CountryCode;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(VACANCY_LIMITS.city)
  city?: string | null;

  @ApiProperty({ enum: careTypeValues }) @IsIn(careTypeValues)
  careSetting!: CareType;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  rolesCount!: number;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(20) @MaxLength(VACANCY_LIMITS.description)
  description!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(VACANCY_LIMITS.requirements)
  requirements?: string | null;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0) @Max(30)
  minExperienceYears!: number;

  @ApiProperty({ enum: englishLevelValues }) @IsIn(englishLevelValues)
  englishLevel!: EnglishLevel;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  salaryMin?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999)
  salaryMax?: number | null;

  @ApiPropertyOptional({ enum: CURRENCY_CODES, nullable: true }) @IsOptional() @Transform(upper) @ValidateIf((_, v) => v !== null) @IsIn(CURRENCY_CODES)
  salaryCurrency?: CurrencyCode | null;

  @ApiPropertyOptional({ enum: salaryPeriodValues, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(salaryPeriodValues)
  salaryPeriod?: SalaryPeriod | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(120)
  contractMonths?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsBoolean()
  accommodationProvided?: boolean | null;

  @ApiProperty({ enum: visaSponsorshipValues }) @IsIn(visaSponsorshipValues)
  visaSponsorship!: VisaSponsorship;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100)
  startTimeframe?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @Matches(DATE) @IsDateString()
  closesOn?: string | null;
}

/** Staff posting a vacancy for an enquiry they are working. */
export class StaffVacancyDto extends VacancyDto {
  @ApiProperty() @IsUUID()
  enquiryId!: string;
}

export class VacancyQueryDto {
  @ApiPropertyOptional({ enum: COUNTRY_CODES }) @IsOptional() @IsIn(COUNTRY_CODES)
  country?: CountryCode;

  @ApiPropertyOptional({ enum: careTypeValues }) @IsOptional() @IsIn(careTypeValues)
  careSetting?: CareType;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  pageSize?: number;
}

export class StaffVacancyQueryDto {
  @ApiPropertyOptional({ enum: vacancyStatusValues }) @IsOptional() @IsIn(vacancyStatusValues)
  status?: VacancyStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  enquiryId?: string;
}

export class ReviewVacancyDto {
  @ApiProperty({ enum: ['PUBLISHED', 'REJECTED', 'CLOSED', 'FILLED'] }) @IsIn(['PUBLISHED', 'REJECTED', 'CLOSED', 'FILLED'])
  status!: Exclude<VacancyStatus, 'PENDING_REVIEW'>;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  note?: string | null;
}

export class ApplyVacancyDto {
  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(VACANCY_LIMITS.applicationMessage)
  message?: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional({ enum: ['PUT_FORWARD', 'NOT_SUCCESSFUL', 'APPLIED'] }) @IsOptional() @IsIn(['PUT_FORWARD', 'NOT_SUCCESSFUL', 'APPLIED'])
  status?: Exclude<VacancyApplicationStatus, 'WITHDRAWN'>;

  @ApiPropertyOptional({ nullable: true, description: 'Shown to the employer when the caregiver is put forward' })
  @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  messageToEmployer?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  staffNote?: string | null;
}

// --- placements ---------------------------------------------------------------------

const optionalDate = () => (target: object, key: string) => {
  ApiPropertyOptional({ nullable: true, description: 'YYYY-MM-DD' })(target, key);
  IsOptional()(target, key);
  Transform(blankToNull)(target, key);
  ValidateIf((_: unknown, v: unknown) => v !== null)(target, key);
  Matches(DATE)(target, key);
  IsDateString()(target, key);
};

export class UpdatePlacementDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(150)
  jobTitle?: string | null;

  @ApiPropertyOptional({ enum: placementStatusValues }) @IsOptional() @IsIn(placementStatusValues)
  status?: PlacementStatus;

  @optionalDate() departureOn?: string | null;
  @optionalDate() arrivedOn?: string | null;
  @optionalDate() contractStartOn?: string | null;
  @optionalDate() endedOn?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(120)
  contractMonths?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  endReason?: string | null;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(24)
  guaranteeMonths?: number;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  feeAmount?: number | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(upper) @ValidateIf((_, v) => v !== null) @IsIn(CURRENCY_CODES)
  feeCurrency?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000)
  staffNote?: string | null;
}

export class PlacementQueryDto {
  @ApiPropertyOptional({ enum: [...placementStatusValues, 'active'] }) @IsOptional() @IsIn([...placementStatusValues, 'active'])
  status?: PlacementStatus | 'active';
}

export class UpdateCheckinDto {
  @optionalDate() completedOn!: string | null;

  @ApiPropertyOptional({ enum: checkinOutcomeValues, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(checkinOutcomeValues)
  outcome?: CheckinOutcome | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(1000)
  note?: string | null;
}

// --- placement invoices -----------------------------------------------------------------

export class PlacementInvoiceDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID()
  placementId?: string | null;

  @ApiPropertyOptional({ description: 'Required when there is no placement' }) @ValidateIf((o: PlacementInvoiceDto) => !o.placementId) @IsUUID()
  enquiryId?: string;

  @ApiProperty({ enum: CURRENCY_CODES }) @Transform(upper) @IsIn(CURRENCY_CODES)
  currency!: CurrencyCode;

  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(9_999_999)
  amount!: number;

  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(300)
  description!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToUndefined) @IsString() @MaxLength(200)
  billToName?: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(255)
  billToEmail?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  billToAddress?: string | null;

  @ApiPropertyOptional({ enum: COUNTRY_CODES, nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(COUNTRY_CODES)
  billToCountry?: CountryCode | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(2000)
  notes?: string | null;
}

/** Changing a draft: what it is for stays as it was raised. */
export class UpdatePlacementInvoiceDto extends OmitType(PlacementInvoiceDto, ['placementId', 'enquiryId'] as const) {}

export class PlacementInvoiceQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ISSUED', 'PAID', 'VOID', 'overdue'] }) @IsOptional() @IsIn(['DRAFT', 'ISSUED', 'PAID', 'VOID', 'overdue'])
  status?: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID' | 'overdue';
}

export class VoidPlacementInvoiceDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}

export class PlacementPaymentDto {
  @ApiProperty({ description: 'Negative for a refund' }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-9_999_999) @Max(9_999_999)
  amount!: number;

  @ApiProperty({ enum: placementPaymentMethodValues }) @IsIn(placementPaymentMethodValues)
  method!: PlacementPaymentMethod;

  @ApiProperty() @Matches(DATE) @IsDateString()
  paidOn!: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120)
  reference?: string | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @Transform(blankToNull) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500)
  note?: string | null;
}

// --- documents -------------------------------------------------------------------------

export class ExpiringDocumentsQueryDto {
  @ApiPropertyOptional({ default: 90 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365)
  withinDays?: number;
}
