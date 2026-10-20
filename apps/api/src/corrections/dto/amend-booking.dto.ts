import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { shiftRateTypeEnum, type ShiftRateType } from '../../database/schema';

/** A datetime-local value, read as Colombo time. */
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** One correction can touch at most this many shifts - a bigger change is a reschedule or a rebooking. */
export const MAX_AMENDED_SHIFTS = 62;
export const MAX_ADDED_SHIFTS = 31;

export const amendShiftStatuses = ['SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'] as const;

class ShiftRatesDto {
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class AmendShiftDto extends ShiftRatesDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Choose a shift' })
  shiftId: string;

  @ApiPropertyOptional({ example: '2026-10-12T08:00', description: 'Colombo time' })
  @IsOptional()
  @Matches(LOCAL, { message: 'Enter the start date and time' })
  start?: string;

  @ApiPropertyOptional({ example: '2026-10-12T19:00', description: 'Colombo time' })
  @IsOptional()
  @Matches(LOCAL, { message: 'Enter the end date and time' })
  end?: string;

  @ApiPropertyOptional({ enum: amendShiftStatuses })
  @IsOptional()
  @IsIn(amendShiftStatuses, { message: 'Choose what happened' })
  status?: (typeof amendShiftStatuses)[number];

  @ApiPropertyOptional({ description: 'Who actually worked it' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;
}

export class AmendAddShiftDto extends ShiftRatesDto {
  @ApiProperty({ example: '2026-10-12T08:00', description: 'Colombo time' })
  @Matches(LOCAL, { message: 'Enter the start date and time' })
  start: string;

  @ApiProperty({ example: '2026-10-12T17:00', description: 'Colombo time' })
  @Matches(LOCAL, { message: 'Enter the end date and time' })
  end: string;

  @ApiPropertyOptional({ description: 'Who worked it; defaults to the booked caregiver' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid caregiver' })
  caregiverId?: string;
}

export class AmendBookingDto {
  @ApiProperty({ description: 'Why the record was wrong - kept in the booking history' })
  @Transform(trimToUndefined)
  @IsString({ message: 'Say what was wrong' })
  @MinLength(3, { message: 'Say what was wrong' })
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ example: '3500.00', description: "The booking's client rate amount, when it was wrong all along" })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the agreed rate as a number' })
  rateAmount?: string;

  @ApiPropertyOptional({ example: '2500.00', description: "The booking's pay rate amount, when it was wrong all along" })
  @IsOptional()
  @Matches(MONEY, { message: 'Enter the pay rate as a number' })
  payRateAmount?: string;

  @ApiPropertyOptional({ type: [AmendShiftDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_AMENDED_SHIFTS, { message: `Correct at most ${MAX_AMENDED_SHIFTS} shifts at a time` })
  @ValidateNested({ each: true })
  @Type(() => AmendShiftDto)
  shifts?: AmendShiftDto[];

  @ApiPropertyOptional({ type: [AmendAddShiftDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ADDED_SHIFTS, { message: `Add at most ${MAX_ADDED_SHIFTS} shifts at a time` })
  @ValidateNested({ each: true })
  @Type(() => AmendAddShiftDto)
  addShifts?: AmendAddShiftDto[];

  @ApiPropertyOptional({ description: "Issued invoices with nothing paid: invoice id -> 'REPLACE' (default) or 'CARRY'" })
  @IsOptional()
  @IsObject()
  invoiceActions?: Record<string, 'REPLACE' | 'CARRY'>;
}
