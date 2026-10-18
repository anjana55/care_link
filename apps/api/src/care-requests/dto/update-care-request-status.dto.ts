import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  careRequestCloseReasonEnum,
  careRequestStatusEnum,
  type CareRequestCloseReason,
  type CareRequestStatus,
} from '../../database/schema';

const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class UpdateCareRequestStatusDto {
  @ApiProperty({ enum: careRequestStatusEnum })
  @IsEnum(careRequestStatusEnum, { message: 'Choose a valid status' })
  status: CareRequestStatus;

  @ApiPropertyOptional({ enum: careRequestCloseReasonEnum, description: 'Required when closing' })
  @ValidateIf((o: UpdateCareRequestStatusDto) => o.status === 'CLOSED')
  @IsEnum(careRequestCloseReasonEnum, { message: 'Choose why the request is being closed' })
  closeReason?: CareRequestCloseReason;

  @ApiPropertyOptional({ description: 'Optional internal note recorded with the change' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  note?: string;
}

export class AddCareRequestNoteDto {
  @ApiProperty()
  @Transform(trimToUndefined)
  @IsString({ message: 'Write a note first' })
  @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  note: string;
}

export class AssignCareRequestDto {
  @ApiProperty({ nullable: true, description: 'Staff/admin user id, or null to unassign' })
  @IsOptional()
  @IsString()
  userId: string | null;
}
