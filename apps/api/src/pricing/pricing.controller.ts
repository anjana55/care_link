import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { careTypeValues, type CareType } from '@care-platform/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PricingService } from './pricing.service';
import { UpdateCareTypePricingDto, UpdateCaregiverRatesDto } from './dto/pricing.dto';

const careTypePipe = new ParseEnumPipe(Object.fromEntries(careTypeValues.map((v) => [v, v])));

/** Settings > Rates and fees. Staff can read it (they price bookings); only an admin changes it. */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/pricing')
export class PricingSettingsController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @Roles('ADMIN', 'STAFF')
  get() {
    return this.pricing.pricing();
  }

  @Patch(':careType')
  @Roles('ADMIN')
  @Audit({ action: 'UPDATE_CARE_TYPE_PRICING', entityType: 'CareTypePricing' })
  update(@Param('careType', careTypePipe) careType: CareType, @Body() dto: UpdateCareTypePricingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.updatePricing(careType, dto, user.userId);
  }
}

/** A caregiver's rate card: their own to read and set; staff can do both on their behalf. */
@ApiTags('caregivers')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/rates')
export class CaregiverRatesController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @CaregiverScope('ADMIN', 'STAFF')
  get(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.pricing.rateCard(caregiverId);
  }

  @Put()
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'UPDATE_CAREGIVER_RATES', entityType: 'CaregiverRates' })
  set(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: UpdateCaregiverRatesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pricing.setRates(caregiverId, dto, user.userId);
  }

  /** What a booking would be priced at; null in the body when it has to be priced by hand. */
  @Get('quote/:careType')
  @Roles('ADMIN', 'STAFF')
  async quote(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('careType', careTypePipe) careType: CareType) {
    return { quote: await this.pricing.quote(caregiverId, careType) };
  }
}
