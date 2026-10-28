import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import {
  bookingStatusEnum,
  careRequestLanguageEnum,
  rateTypeEnum,
  scheduleTypeEnum,
  shiftRateTypeEnum,
  shiftStatusEnum,
  type BookingStatus,
  type CareRequestLanguage,
  type RateType,
  type ScheduleType,
  type ShiftRateType,
  type ShiftStatus,
} from '../../database/schema';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A datetime-local value, read as Colombo time. */
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** The repeating pattern a booking's shifts are generated from. */
export class BookingPatternDto {
  @ApiProperty({ enum: scheduleTypeEnum })
  @IsEnum(scheduleTypeEnum, { message: 'Choose a schedule type' })
  scheduleType: ScheduleType;

  @ApiProperty({ type: [Number], description: 'ISO weekdays, 1 = Monday ... 7 = Sunday', example: [1, 2, 3, 4, 5] })
  @IsArray({ message: 'Choose the days of the week' })
  @ArrayMinSize(1, { message: 'Choose at least one day of the week' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  daysOfWeek: number[];

  @ApiProperty({ example: '08:00', description: 'Colombo time' })
  @Matches(TIME, { message: 'Enter the start time as HH:MM' })
  shiftStartTime: string;

  @ApiProperty({ example: '17:00', description: 'Colombo time; at or before the start time means it ends the next day' })
  @Matches(TIME, { message: 'Enter the end time as HH:MM' })
  shiftEndTime: string;

  @ApiProperty({ example: '2026-10-20' })
  @Matches(DATE, { message: 'Enter the start date' })
  startDate: string;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(DATE, { message: 'Enter the end date' })
  endDate: string;
}

export class CreateBookingDto extends BookingPatternDto {
  @ApiPropertyOptional({ description: 'The care request this booking comes from' })
  @IsOptional()
  @IsUUID()
  careRequestId?: string;

  @ApiPropertyOptional({ description: 'Required unless careRequestId is given' })
  @ValidateIf((o: CreateBookingDto) => !o.careRequestId)
  @IsUUID('all', { message: 'Choose the client' })
  patientId?: string;

  @ApiPropertyOptional({ description: 'Required unless the care request has a caregiver' })
  @ValidateIf((o: CreateBookingDto) => !o.careRequestId)
  @IsUUID('all', { message: 'Choose the caregiver' })
  caregiverId?: string;

  @ApiPropertyOptional({ enum: rateTypeEnum })
  @IsOptional()
  @IsEnum(rateTypeEnum, { message: 'Choose how the rate is charged' })
  rateType?: RateType;

  @ApiPropertyOptional({ example: '3500.00' })
  @ValidateIf((o: CreateBookingDto) => Boolean(o.rateType))
  @IsNumberString({}, { message: 'Enter the agreed rate as a number' })
  @Matches(MONEY, { message: 'Enter the agreed rate as a number' })
  rateAmount?: string;

  @ApiPropertyOptional({ enum: rateTypeEnum, description: "How the caregiver is paid - staff only, never shown to the client" })
  @IsOptional()
  @IsEnum(rateTypeEnum, { message: 'Choose how the caregiver is paid' })
  payRateType?: RateType;

  @ApiPropertyOptional({ example: '2500.00' })
  @ValidateIf((o: CreateBookingDto) => Boolean(o.payRateType))
  @Matches(MONEY, { message: 'Enter the pay rate as a number' })
  payRateAmount?: string;

  @ApiPropertyOptional({ enum: careRequestLanguageEnum, description: "Defaults to the request's language, else English" })
  @IsOptional()
  @IsIn(careRequestLanguageEnum, { message: 'Choose the language for updates' })
  language?: CareRequestLanguage;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;
}

/**
 * PATCH /bookings/:id - edit a booking.
 *
 * - Rates, notes and the notices' language: any time until it is closed.
 * - DRAFT: the pattern (it rebuilds the draft roster - shifts that still fit
 *   the new pattern are kept with their edits) and the booked caregiver.
 * - CONFIRMED: the pattern and/or the booked caregiver from `effectiveFrom`
 *   on. Scheduled shifts from that day that still fit are kept, the rest are
 *   cancelled, new ones are scheduled, and the client and caregivers are told.
 *   Shifts before that day, and any that have already started, never change.
 */
export class UpdateBookingDto {
  @ApiPropertyOptional({ enum: rateTypeEnum, nullable: true })
  @IsOptional()
  @IsEnum(rateTypeEnum, { message: 'Choose how the rate is charged' })
  rateType?: RateType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the agreed rate as a number' })
  rateAmount?: string | null;

  @ApiPropertyOptional({ enum: rateTypeEnum, nullable: true })
  @IsOptional()
  @IsEnum(rateTypeEnum, { message: 'Choose how the caregiver is paid' })
  payRateType?: RateType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the pay rate as a number' })
  payRateAmount?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;

  @ApiPropertyOptional({ enum: careRequestLanguageEnum })
  @IsOptional()
  @IsIn(careRequestLanguageEnum, { message: 'Choose the language for updates' })
  language?: CareRequestLanguage;

  @ApiPropertyOptional({ description: 'A new booked caregiver. On a confirmed booking, from effectiveFrom on.' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;

  @ApiPropertyOptional({
    type: BookingPatternDto,
    description: 'DRAFT: replaces the roster. CONFIRMED: the new pattern from effectiveFrom on; its startDate must stay the booking start.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingPatternDto)
  pattern?: BookingPatternDto;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'CONFIRMED only, required with pattern or caregiverId: the first day the change applies to' })
  @IsOptional()
  @Matches(DATE, { message: 'Enter the day the change starts' })
  effectiveFrom?: string;
}

export class ExtendBookingDto {
  @ApiProperty({ example: '2026-12-31' })
  @Matches(DATE, { message: 'Enter the end date' })
  endDate: string;
}

export class CancelBookingDto {
  @ApiProperty()
  @Transform(trimToUndefined)
  @IsString({ message: 'Say why the booking is being cancelled' })
  @MaxLength(500)
  reason: string;
}

export class AddShiftDto {
  @ApiProperty({ example: '2026-10-25T08:00', description: 'Colombo time' })
  @Matches(LOCAL, { message: 'Enter the start date and time' })
  start: string;

  @ApiProperty({ example: '2026-10-25T17:00', description: 'Colombo time' })
  @Matches(LOCAL, { message: 'Enter the end date and time' })
  end: string;

  @ApiPropertyOptional({ description: 'A cover caregiver; defaults to the booked caregiver' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ enum: shiftRateTypeEnum, nullable: true, description: "This shift's own client rate; null = the booking's" })
  @IsOptional()
  @IsEnum(shiftRateTypeEnum, { message: 'Choose how this shift is charged' })
  rateType?: ShiftRateType | null;

  @ApiPropertyOptional({ nullable: true, example: '5000.00' })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the shift rate as a number' })
  rateAmount?: string | null;

  @ApiPropertyOptional({ enum: shiftRateTypeEnum, nullable: true, description: "This shift's own pay rate; null = the booking's" })
  @IsOptional()
  @IsEnum(shiftRateTypeEnum, { message: 'Choose how this shift is paid' })
  payRateType?: ShiftRateType | null;

  @ApiPropertyOptional({ nullable: true, example: '3500.00' })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the shift pay as a number' })
  payRateAmount?: string | null;
}

export class UpdateShiftDto {
  @ApiPropertyOptional({ example: '2026-10-25T08:00', description: 'Colombo time' })
  @IsOptional()
  @Matches(LOCAL, { message: 'Enter the start date and time' })
  start?: string;

  @ApiPropertyOptional({ example: '2026-10-25T17:00', description: 'Colombo time' })
  @IsOptional()
  @Matches(LOCAL, { message: 'Enter the end date and time' })
  end?: string;

  @ApiPropertyOptional({ description: 'Who works this shift (a cover), or the booked caregiver again' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;

  @ApiPropertyOptional({ enum: shiftStatusEnum })
  @IsOptional()
  @IsEnum(shiftStatusEnum, { message: 'Choose a valid status' })
  status?: ShiftStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @ApiPropertyOptional({ enum: shiftRateTypeEnum, nullable: true, description: "This shift's own client rate; null = the booking's" })
  @IsOptional()
  @IsEnum(shiftRateTypeEnum, { message: 'Choose how this shift is charged' })
  rateType?: ShiftRateType | null;

  @ApiPropertyOptional({ nullable: true, example: '5000.00' })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the shift rate as a number' })
  rateAmount?: string | null;

  @ApiPropertyOptional({ enum: shiftRateTypeEnum, nullable: true, description: "This shift's own pay rate; null = the booking's" })
  @IsOptional()
  @IsEnum(shiftRateTypeEnum, { message: 'Choose how this shift is paid' })
  payRateType?: ShiftRateType | null;

  @ApiPropertyOptional({ nullable: true, example: '3500.00' })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the shift pay as a number' })
  payRateAmount?: string | null;
}

export class BookingQueryDto {
  @ApiPropertyOptional({ enum: bookingStatusEnum })
  @IsOptional()
  @IsEnum(bookingStatusEnum)
  status?: BookingStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  caregiverId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  careRequestId?: string;

  @ApiPropertyOptional({ description: 'Only bookings with a client or caregiver report waiting for staff' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasOpenIssues?: boolean;

  @ApiPropertyOptional({ description: 'Only bookings with a critical care-plan item marked Not done, or unconfirmed, in the last 7 days' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  hasCareAlerts?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
