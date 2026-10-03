import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { resolveLocale } from '@care-platform/shared';
import { LocationsService } from './locations.service';
import { BrowseCitiesQueryDto, CitiesQueryDto, TreeQueryDto } from './dto/cities-query.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';

/**
 * Sri Lanka's administrative divisions. Reference data, loaded from CSV -
 * there is no POST here, and there never should be: the districts and cities of
 * a country are not something an admin types in by hand, and a hand-typed row
 * is how the old free-text locations table ended up with near-duplicates.
 *
 * The public routes serve the sign-up and search forms; the admin route backs
 * the read-only browse page in the staff app.
 */
@ApiTags('locations')
@ApiBearerAuth()
@Controller()
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Public()
  @Get('public/meta/locations/tree')
  async tree(@Query() query: TreeQueryDto) {
    return this.locationsService.findTree(resolveLocale(query.locale));
  }

  @Public()
  @Get('public/meta/locations/cities')
  async cities(@Query() query: CitiesQueryDto) {
    return this.locationsService.findCities(query.districtId, resolveLocale(query.locale));
  }

  @Roles('ADMIN', 'STAFF', 'VERIFIER')
  @Get('admin/locations/tree')
  async adminTree(@Query() query: TreeQueryDto) {
    return this.locationsService.findTree(resolveLocale(query.locale));
  }

  @Roles('ADMIN', 'STAFF', 'VERIFIER')
  @Get('admin/locations/cities')
  adminCities(@Query() query: BrowseCitiesQueryDto) {
    return this.locationsService.findCitiesPage({
      districtId: query.districtId,
      page: query.page,
      pageSize: query.pageSize,
      query: query.q,
      locale: resolveLocale(query.locale),
    });
  }
}