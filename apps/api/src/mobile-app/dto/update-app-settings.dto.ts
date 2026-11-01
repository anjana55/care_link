import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

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

/** Android app links. An empty package or list clears it; the rules are checked in the service. */
export class AndroidAppLinksDto {
  @ApiPropertyOptional({ example: 'com.vivantihealth.carelink' })
  @IsOptional() @IsString() @MaxLength(255)
  packageName?: string;

  @ApiPropertyOptional({ type: [String], description: 'SHA-256 signing-certificate fingerprints, AB:12:... (colons and case optional).' })
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true })
  certFingerprints?: string[];
}

export class AppLinksDto {
  @ApiPropertyOptional({ type: AndroidAppLinksDto })
  @IsOptional() @ValidateNested() @Type(() => AndroidAppLinksDto)
  android?: AndroidAppLinksDto;
}

/** Partial update - the admin form sends back what it has. */
export class UpdateAppSettingsDto {
  @ApiPropertyOptional({ type: AppPlatformSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => AppPlatformSettingsDto)
  ios?: AppPlatformSettingsDto;

  @ApiPropertyOptional({ type: AppPlatformSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => AppPlatformSettingsDto)
  android?: AppPlatformSettingsDto;

  @ApiPropertyOptional({ type: AppLinksDto })
  @IsOptional() @ValidateNested() @Type(() => AppLinksDto)
  appLinks?: AppLinksDto;
}
