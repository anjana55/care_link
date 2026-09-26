import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpsertHealthInformationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasDiabetes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasHighBloodPressure?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  surgicalHistory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mentalHealthInformation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  physicalAbilityToLiftPatients?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  otherNotes?: string;
}
