import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PreferredLocationsService } from './preferred-locations.service';
import { AssignPreferredLocationDto } from './dto/assign-preferred-location.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('preferred-locations')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/preferred-locations')
export class PreferredLocationsController {
  constructor(private readonly preferredLocationsService: PreferredLocationsService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.preferredLocationsService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ASSIGN_PREFERRED_LOCATION', entityType: 'Caregiver' })
  assign(@Param('caregiverId') caregiverId: string, @Body() dto: AssignPreferredLocationDto) {
    return this.preferredLocationsService.assign(caregiverId, dto.locationId);
  }

  @Delete(':locationId')
  @CaregiverScope()
  @Audit({ action: 'REMOVE_PREFERRED_LOCATION', entityType: 'Caregiver' })
  remove(@Param('caregiverId') caregiverId: string, @Param('locationId') locationId: string) {
    return this.preferredLocationsService.remove(caregiverId, locationId);
  }
}
