import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';
import { whatsappProviderEnum, type WhatsappProvider } from '../../database/schema';

/**
 * Partial update - the admin form sends back only what changed. Bounds on the
 * OTP policy are deliberate guard rails: a code shorter than 4 digits or
 * living longer than 15 minutes, or unlimited attempts, would undermine the
 * whole point of verifying a phone number.
 */
export class UpdateWhatsappSettingsDto {
  @ApiPropertyOptional({ description: 'Master switch for WhatsApp sign-in' })
  @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() caregiverEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() customerEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() registrationEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() loginEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() recoveryEnabled?: boolean;

  @ApiPropertyOptional({ enum: whatsappProviderEnum })
  @IsOptional() @IsIn(whatsappProviderEnum) provider?: WhatsappProvider;

  @ApiPropertyOptional({ example: 'https://graph.facebook.com' })
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(255) apiBaseUrl?: string;

  @ApiPropertyOptional({ example: 'v21.0' })
  @IsOptional() @Matches(/^v\d{1,2}\.\d$/, { message: 'API version must look like v21.0' }) apiVersion?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5,32}$/, { message: 'Phone number ID must be digits only' }) phoneNumberId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{5,32}$/, { message: 'Business account ID must be digits only' }) businessAccountId?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored token.' })
  @IsOptional() @IsString() @MaxLength(1024) accessToken?: string;
  @ApiPropertyOptional({ description: 'Remove the stored access token' })
  @IsOptional() @IsBoolean() clearAccessToken?: boolean;

  @ApiPropertyOptional({ example: 'carelink_otp' })
  @IsOptional() @Matches(/^[a-z0-9_]{1,128}$/, { message: 'Template names use lowercase letters, digits and underscores' }) templateName?: string;
  @ApiPropertyOptional({ example: 'en' })
  @IsOptional() @Matches(/^[a-z]{2,3}(_[A-Z]{2})?$/, { message: 'Use a WhatsApp language code such as en, si or en_US' }) templateLanguage?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() templateHasCopyCodeButton?: boolean;

  @ApiPropertyOptional({ minimum: 4, maximum: 8 }) @IsOptional() @IsInt() @Min(4) @Max(8) otpLength?: number;
  @ApiPropertyOptional({ minimum: 60, maximum: 900 }) @IsOptional() @IsInt() @Min(60) @Max(900) otpTtlSeconds?: number;
  @ApiPropertyOptional({ minimum: 3, maximum: 10 }) @IsOptional() @IsInt() @Min(3) @Max(10) otpMaxAttempts?: number;
  @ApiPropertyOptional({ minimum: 15, maximum: 600 }) @IsOptional() @IsInt() @Min(15) @Max(600) otpResendCooldownSeconds?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 20 }) @IsOptional() @IsInt() @Min(1) @Max(20) otpMaxSendsPerHour?: number;

  @ApiPropertyOptional({ example: '94', description: 'Digits only, no plus sign' })
  @IsOptional() @Matches(/^\d{1,3}$/, { message: 'Country code must be 1-3 digits, without a plus sign' }) defaultCountryCode?: string;
}

export class SendTestMessageDto {
  @ApiPropertyOptional({ example: '0771234567' })
  @IsString() @MaxLength(32) phone: string;
}
