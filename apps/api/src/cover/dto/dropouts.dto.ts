import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { CANT_MAKE_NOTE_MAX } from '@care-platform/shared';

export class CantMakeShiftDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(CANT_MAKE_NOTE_MAX, { message: 'Keep the note under 200 characters' })
  note?: string;
}

export class SetStandbyDto {
  /** Null removes the standby. */
  @ValidateIf((_o, v) => v !== null)
  @IsUUID('4', { message: 'Choose a caregiver' })
  caregiverId!: string | null;
}
