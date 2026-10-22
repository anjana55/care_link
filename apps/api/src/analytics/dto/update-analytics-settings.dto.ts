import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Partial update - the admin form sends back what it has. The measurement ID
 * is accepted bare or as the whole Google tag snippet, and an empty string
 * clears it; it is checked and normalised in the service, against the same
 * rule the form checks with.
 */
export class UpdateAnalyticsSettingsDto {
  @ApiPropertyOptional({ description: 'Measure the public site with Google Analytics. Needs a measurement ID.' })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'G-AB12CD34EF' })
  @IsOptional() @IsString() @MaxLength(2000)
  measurementId?: string;
}
