import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { caregiverStatusEnum, clientStatusEnum } from '../../database/schema';

/** The filters an export can take - the ones the caregivers and clients lists already offer. */
export class TransferFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  districtId?: number;
}

export class CaregiverExportDto extends TransferFilterDto {
  @ApiPropertyOptional({ enum: caregiverStatusEnum })
  @IsOptional()
  @IsIn(caregiverStatusEnum)
  status?: (typeof caregiverStatusEnum)[number];
}

export class ClientExportDto extends TransferFilterDto {
  @ApiPropertyOptional({ enum: clientStatusEnum })
  @IsOptional()
  @IsIn(clientStatusEnum)
  status?: (typeof clientStatusEnum)[number];
}

export class ImportOptionsDto {
  /** true (the default): check the file and report, change nothing. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  dryRun?: boolean;
}
