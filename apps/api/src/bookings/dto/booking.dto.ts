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
} from 'class-validator';
import {
  bookingStatusEnum,
  careRequestLanguageEnum,
  rateTypeEnum,
  scheduleTypeEnum,
  shiftStatusEnum,
  type BookingStatus,
  type CareRequestLanguage,
  type RateType,
  type ScheduleType,
  type ShiftStatus,
} from '../../database/schema';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A datetime-local value, read as Colombo time. */
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
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
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'Enter the agreed rate as a number' })
  rateAmount?: string;

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

/** PATCH /bookings/:id - rate and notes any time; the pattern only while DRAFT (it regenerates the shifts). */
export class UpdateBookingDto {
  @ApiPropertyOptional({ enum: rateTypeEnum, nullable: true })
  @IsOptional()
  @IsEnum(rateTypeEnum, { message: 'Choose how the rate is charged' })
  rateType?: RateType | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'Enter the agreed rate as a number' })
  rateAmount?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;

  @ApiPropertyOptional({ type: BookingPatternDto, description: 'DRAFT only - replaces every shift' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingPatternDto)
  pattern?: BookingPatternDto;
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
