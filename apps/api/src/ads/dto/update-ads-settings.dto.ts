import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Partial update - the admin form sends back what it has. The publisher ID is
 * accepted in any of the forms AdSense shows it ("ca-pub-…", "pub-…", or the
 * whole script snippet) and an empty string clears it; an empty slot ID means
 * "no ad unit there". Both are checked and normalised in the service, against
 * the same rule the form checks with.
 */
export class UpdateAdsSettingsDto {
  @ApiPropertyOptional({ description: 'Show Google ads on the public site. Needs a publisher ID.' })
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 'ca-pub-0123456789012345' })
  @IsOptional() @IsString() @MaxLength(2000)
  publisherId?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Ad unit on the landing page. Empty = none.' })
  @IsOptional() @IsString() @MaxLength(40)
  slotHome?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Ad unit below the search results. Empty = none.' })
  @IsOptional() @IsString() @MaxLength(40)
  slotSearch?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'Ad unit on public caregiver profiles. Empty = none.' })
  @IsOptional() @IsString() @MaxLength(40)
  slotProfile?: string;
}
