import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { InsightsService } from './insights.service';
import { InsightsQueryDto } from './dto/insights-query.dto';

/**
 * The staff dashboard's business vital signs. ADMIN and STAFF - the same
 * people who already see requests, bookings and billing. A VERIFIER keeps the
 * caregiver-only dashboard (GET /caregivers/dashboard).
 */
@ApiTags('insights')
@ApiBearerAuth()
@Controller('insights')
@Roles('ADMIN', 'STAFF')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('overview')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  overview(@Query() query: InsightsQueryDto) {
    return this.insights.overview(query.range ?? '30d', query.locale);
  }
}
