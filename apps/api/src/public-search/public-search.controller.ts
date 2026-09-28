import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { PublicSearchService } from './public-search.service';
import { SearchRequestDto } from './dto/search-request.dto';
import { PublicSearchConfigDto } from './dto/public-search-config.dto';
import { SkillsService } from '../skills/skills.service';
import { LanguagesService } from '../languages/languages.service';
import { LocationsService } from '../locations/locations.service';

/**
 * Everything here is `@Public()` - reachable without a JWT, by design. That
 * makes this controller the API's actual public attack surface, so:
 *   - every route gets its own, tighter throttle than the app-wide default
 *     (see ThrottlerModule config in app.module.ts)
 *   - nothing here ever imports CaregiversService or selects raw rows from
 *     `caregivers` beyond the columns PublicSearchService explicitly lists
 *   - search is POST, not GET, so filter payloads (which may one day
 *     include patient medical-condition free text) don't end up in access
 *     logs or shareable URLs the way query strings do
 */
@ApiTags('public-search')
@Controller('public')
export class PublicSearchController {
  constructor(
    private readonly publicSearchService: PublicSearchService,
    private readonly skillsService: SkillsService,
    private readonly languagesService: LanguagesService,
    private readonly locationsService: LocationsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('search')
  @HttpCode(200)
  search(@Body() dto: SearchRequestDto) {
    return this.publicSearchService.search(dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('caregivers/:publicId')
  findOne(@Param('publicId') publicId: string) {
    return this.publicSearchService.findByPublicId(publicId);
  }

  @Public()
  @Get('meta/skills')
  async skills() {
    const rows = await this.skillsService.findAll();
    return rows.map((s) => ({ id: s.id, name: s.name, category: s.category }));
  }

  @Public()
  @Get('meta/languages')
  async languages() {
    const rows = await this.languagesService.findAll();
    return rows.map((l) => ({ id: l.id, name: l.name }));
  }

  @Public()
  @Get('meta/locations')
  async locations() {
    const rows = await this.locationsService.findAll();
    return rows.map((l) => ({ id: l.id, district: l.district, city: l.city, province: l.province }));
  }

  @Public()
  @Get('meta/search-config')
  searchConfig(): PublicSearchConfigDto {
    // Hard-coded false until the AI pipeline + ai_search_config table exist
    // (explicitly out of scope for this phase) - never advertise a search
    // mode the backend can't actually serve.
    return { aiSearchEnabled: false };
  }
}
