import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Partial update for one provider; the admin form sends back what it has.
 * Validation of the *resulting* configuration (an enabled provider must be
 * complete) lives in the service, where the stored values are known.
 */
export class UpdateSocialProviderSettingsDto {
  @ApiPropertyOptional({ description: 'Show this provider on the sign-in and registration screens' })
  @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ description: 'OAuth client / application ID' })
  @IsOptional() @IsString() @MaxLength(255) @Matches(/^\S+$/, { message: 'The client ID cannot contain spaces' }) clientId?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored secret.' })
  @IsOptional() @IsString() @MaxLength(1024) clientSecret?: string;
  @ApiPropertyOptional({ description: 'Remove the stored client secret' })
  @IsOptional() @IsBoolean() clearClientSecret?: boolean;

  @ApiPropertyOptional({ example: 'common', description: 'Microsoft only' })
  @IsOptional() @MaxLength(128) @Matches(/^(common|organizations|consumers|[0-9a-fA-F-]{36}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/, {
    message: 'Use common, organizations, consumers, a tenant ID or a tenant domain',
  }) tenant?: string;

  @ApiPropertyOptional({ example: 'v21.0', description: 'Facebook only' })
  @IsOptional() @Matches(/^v\d{1,2}\.\d$/, { message: 'API version must look like v21.0' }) apiVersion?: string;
}
