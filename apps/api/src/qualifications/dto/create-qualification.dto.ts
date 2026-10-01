import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { qualificationTypeEnum } from '../../database/schema/qualifications.schema';

export class CreateQualificationDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ enum: qualificationTypeEnum })
  @IsEnum(qualificationTypeEnum)
  type: (typeof qualificationTypeEnum)[number];

  @ApiProperty()
  @IsString()
  institution: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  certificateNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentId?: string;
}
