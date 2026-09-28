import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { caregiverStatusEnum } from '../../database/schema/caregivers.schema';

export class UpdateStatusDto {
  @ApiProperty({ enum: caregiverStatusEnum })
  @IsEnum(caregiverStatusEnum)
  status: (typeof caregiverStatusEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
