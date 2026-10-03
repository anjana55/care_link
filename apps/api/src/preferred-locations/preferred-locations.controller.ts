import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PreferredLocationsService } from './preferred-locations.service';
import { AssignPreferredLocationDto } from './dto/assign-preferred-location.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { resolveLocale } from '@care-platform/shared';

@ApiTags('preferred-locations')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/preferred-locations')
export class PreferredLocationsController {
  constructor(private readonly preferredLocationsService: PreferredLocationsService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string, @Query('locale') locale?: string) {
    return this.preferredLocationsService.findAllForCaregiver(caregiverId, resolveLocale(locale));
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ASSIGN_PREFERRED_LOCATION', entityType: 'Caregiver' })
  assign(@Param('caregiverId') caregiverId: string, @Body() dto: AssignPreferredLocationDto) {
    return this.preferredLocationsService.assign(caregiverId, dto.cityId);
  }

  @Delete(':cityId')
  @CaregiverScope()
  @Audit({ action: 'REMOVE_PREFERRED_LOCATION', entityType: 'Caregiver' })
  remove(@Param('caregiverId') caregiverId: string, @Param('cityId') cityId: string) {
    return this.preferredLocationsService.remove(caregiverId, Number(cityId));
  }
}
