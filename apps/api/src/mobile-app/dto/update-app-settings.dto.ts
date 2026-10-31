import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** One platform's settings. An empty string clears a field; the rules are checked in the service. */
export class AppPlatformSettingsDto {
  @ApiPropertyOptional({ example: '1.0.0', description: 'Older builds are blocked until updated.' })
  @IsOptional() @IsString() @MaxLength(16)
  minimumVersion?: string;

  @ApiPropertyOptional({ example: '1.2.0', description: 'Older builds are offered an update.' })
  @IsOptional() @IsString() @MaxLength(16)
  latestVersion?: string;

  @ApiPropertyOptional({ example: 'https://apps.apple.com/app/id0000000000' })
  @IsOptional() @IsString() @MaxLength(500)
  storeUrl?: string;
}

/** Partial update - the admin form sends back what it has. */
export class UpdateAppSettingsDto {
  @ApiPropertyOptional({ type: AppPlatformSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => AppPlatformSettingsDto)
  ios?: AppPlatformSettingsDto;

  @ApiPropertyOptional({ type: AppPlatformSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => AppPlatformSettingsDto)
  android?: AppPlatformSettingsDto;
}
