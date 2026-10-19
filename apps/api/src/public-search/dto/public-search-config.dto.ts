import { ApiProperty } from '@nestjs/swagger';
import type { PublicSearchConfig } from '@care-platform/shared';

/** Swagger-visible shape for GET /public/meta/search-config. Driven by
 * Settings > AI (ai_settings): true only while AI and its public-search switch
 * are both on. */
export class PublicSearchConfigDto implements PublicSearchConfig {
  @ApiProperty()
  aiSearchEnabled: boolean;
}
