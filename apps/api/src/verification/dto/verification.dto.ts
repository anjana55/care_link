import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { verificationTypeEnum } from '../../database/schema/verification.schema';
import { verificationStatusEnum } from '../../database/schema/qualifications.schema';

export class CreateVerificationDto {
  @ApiProperty({ enum: verificationTypeEnum })
  @IsEnum(verificationTypeEnum)
  verificationType: (typeof verificationTypeEnum)[number];

  @ApiPropertyOptional({ enum: verificationStatusEnum })
  @IsOptional()
  @IsEnum(verificationStatusEnum)
  status?: (typeof verificationStatusEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVerificationDto {
  @ApiProperty({ enum: verificationStatusEnum })
  @IsEnum(verificationStatusEnum)
  status: (typeof verificationStatusEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
