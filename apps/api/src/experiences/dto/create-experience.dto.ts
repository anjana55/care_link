import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateExperienceDto {
  @ApiProperty()
  @IsString()
  employerOrClient: string;

  @ApiProperty()
  @IsString()
  role: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty()
  @IsString()
  country: string;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  careType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceContact?: string;
}
