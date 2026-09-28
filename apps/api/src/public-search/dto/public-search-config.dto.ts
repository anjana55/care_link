import { ApiProperty } from '@nestjs/swagger';
import type { PublicSearchConfig } from '@care-platform/shared';

/** Swagger-visible shape for GET /public/meta/search-config. The real,
 * admin-editable config (ai_search_config table) lands in a later phase -
 * for now this always reports AI search as disabled, which is honest: the
 * AI pipeline isn't built yet, so the frontend must not offer it. */
export class PublicSearchConfigDto implements PublicSearchConfig {
  @ApiProperty()
  aiSearchEnabled: boolean;
}
