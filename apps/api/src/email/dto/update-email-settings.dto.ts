import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * Partial update - the admin form sends back what it has. An empty string for
 * an optional text field (username, reply-to) means "clear it". Validation of
 * the *resulting* configuration (delivery switched on must be complete) lives
 * in the service, where the stored values are known.
 */
export class UpdateEmailSettingsDto {
  @ApiPropertyOptional({ description: 'Deliver email through this server. Off = emails are only written to the API log.' })
  @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ example: 'email-smtp.ap-south-1.amazonaws.com' })
  @IsOptional() @IsString() @MaxLength(255)
  @Matches(/^$|^[A-Za-z0-9.-]+$/, { message: 'Enter a host name such as smtp.example.com, without http:// or a port' })
  host?: string;

  @ApiPropertyOptional({ example: 587 })
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;

  @ApiPropertyOptional({ description: 'true = TLS from the first byte (usually port 465); false = STARTTLS (usually 587)' })
  @IsOptional() @IsBoolean() secure?: boolean;

  @ApiPropertyOptional({ description: 'Leave blank for a relay that accepts mail without signing in' })
  @IsOptional() @IsString() @MaxLength(255) username?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored password.' })
  @IsOptional() @IsString() @MaxLength(1024) password?: string;
  @ApiPropertyOptional({ description: 'Remove the stored password' })
  @IsOptional() @IsBoolean() clearPassword?: boolean;

  @ApiPropertyOptional({ example: 'CareLink' })
  @IsOptional() @IsString() @MaxLength(128)
  @Matches(/^[^<>"\r\n]*$/, { message: 'The sender name cannot contain < > " or line breaks' })
  fromName?: string;

  @ApiPropertyOptional({ example: 'no-reply@example.com' })
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail({}, { message: 'Enter a valid sender address' }) @MaxLength(255)
  fromAddress?: string;

  @ApiPropertyOptional({ example: 'support@example.com' })
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail({}, { message: 'Enter a valid reply-to address' }) @MaxLength(255)
  replyTo?: string;
}

export class SendTestEmailDto {
  @ApiPropertyOptional({ example: 'me@example.com' })
  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(255)
  to: string;
}
