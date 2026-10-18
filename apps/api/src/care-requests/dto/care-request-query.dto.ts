import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { careRequestStatusEnum, type CareRequestStatus } from '../../database/schema';

/** Query for the staff Requests queue. */
export class CareRequestQueryDto {
  @ApiPropertyOptional({ enum: careRequestStatusEnum })
  @IsOptional()
  @IsEnum(careRequestStatusEnum)
  status?: CareRequestStatus;

  @ApiPropertyOptional({ description: 'Open = NEW or IN_PROGRESS', enum: ['open'] })
  @IsOptional()
  @IsIn(['open'])
  scope?: 'open';

  @ApiPropertyOptional({ description: 'Reference, client name/phone/email, or caregiver name/registration number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: ['me', 'unassigned'] })
  @IsOptional()
  @IsIn(['me', 'unassigned'])
  assigned?: 'me' | 'unassigned';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  caregiverId?: string;

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
