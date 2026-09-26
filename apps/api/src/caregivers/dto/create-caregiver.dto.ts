import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { civilStatusEnum, genderEnum } from '../../database/schema/caregivers.schema';

export class CreateCaregiverDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName: string;

  @ApiProperty()
  @IsString()
  permanentAddress: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  nic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  passportNumber?: string;

  @ApiProperty()
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: genderEnum })
  @IsEnum(genderEnum)
  gender: (typeof genderEnum)[number];

  @ApiProperty({ enum: civilStatusEnum })
  @IsEnum(civilStatusEnum)
  civilStatus: (typeof civilStatusEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  heightCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  weightKg?: number;

  @ApiProperty()
  @IsString()
  primaryPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  secondaryPhone?: string;

  @ApiProperty()
  @IsString()
  emergencyContactName: string;

  @ApiProperty()
  @IsString()
  emergencyContactNumber: string;

  @ApiProperty()
  @IsString()
  emergencyContactRelationship: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  policeDivision?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  policeStation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;
}
