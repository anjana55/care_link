import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LOCALES, type Locale } from '@care-platform/shared';

/**
 * Partial update - the admin form sends back what it has. An empty string for
 * the short name or tagline means "clear it" (a cleared short name falls back
 * to the company name's initials). Whether the colours are readable is checked
 * in the service, against the same rule the form previews with.
 */
export class UpdateBrandingSettingsDto {
  @ApiPropertyOptional({ example: 'Golden Years Care' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  @Matches(/\S/, { message: 'Enter the company name' })
  companyName?: string;

  @ApiPropertyOptional({ example: 'GY', description: '1-4 letters shown in the badge when there is no logo. Empty = initials of the company name.' })
  @IsOptional() @IsString()
  @Matches(/^$|^[^\s<>]{1,4}$/u, { message: 'The short name is 1 to 4 characters, with no spaces' })
  shortName?: string;

  @ApiPropertyOptional({ example: 'Trusted care, close to home' })
  @IsOptional() @IsString() @MaxLength(160)
  tagline?: string;

  @ApiPropertyOptional({ example: '#5F6952' })
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Enter the primary colour as a hex value, e.g. #5F6952' })
  primaryColor?: string;

  @ApiPropertyOptional({ example: '#2F7A84' })
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Enter the accent colour as a hex value, e.g. #2F7A84' })
  accentColor?: string;

  @ApiPropertyOptional({ enum: LOCALES })
  @IsOptional() @IsIn(LOCALES)
  defaultLocale?: Locale;

  @ApiPropertyOptional({ enum: LOCALES, isArray: true })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(LOCALES.length) @IsIn(LOCALES, { each: true })
  enabledLocales?: Locale[];
}
