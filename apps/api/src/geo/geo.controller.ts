import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, UnprocessableEntityException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { MAX_DEVICE_DISTANCE_FROM_CITY_KM, resolveLocale, type ClientSearchOrigin, type NearestCity } from '@care-platform/shared';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DRIZZLE, type Database } from '../database/database.module';
import { patients } from '../database/schema';
import { GeoService } from './geo.service';
import { NearestCityDto } from './dto/nearest-city.dto';

/** "Use my location" on the public site: the visitor's point -> the city it is in (or nearest to). */
@ApiTags('public-search')
@Controller('public/geo')
export class PublicGeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('nearest-city')
  @HttpCode(200)
  async nearestCity(@Body() dto: NearestCityDto): Promise<NearestCity> {
    const nearest = await this.geo.nearestCity(dto, resolveLocale(dto.locale));
    if (!nearest) throw new NotFoundException('No locations are configured');
    // Somewhere the platform has no cities near: say so rather than pretend
    // the visitor is in whichever city happens to be least far away.
    if (nearest.distanceKm > MAX_DEVICE_DISTANCE_FROM_CITY_KM) {
      throw new UnprocessableEntityException('This location is outside the area we cover');
    }
    return nearest;
  }
}

/** The signed-in client's profile location: where distances fall back to when they searched without a city. */
@ApiTags('client-care')
@ApiBearerAuth()
@Roles('PATIENT_GUARDIAN')
@Controller('me')
export class ClientGeoController {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  @Get('search-origin')
  async searchOrigin(@CurrentUser() user: AuthenticatedUser): Promise<ClientSearchOrigin> {
    if (!user.patientId) return { districtId: null, cityId: null };
    const [row] = await this.db
      .select({ districtId: patients.districtId, cityId: patients.cityId })
      .from(patients)
      .where(eq(patients.id, user.patientId))
      .limit(1);
    return { districtId: row?.districtId ?? null, cityId: row?.cityId ?? null };
  }
}
