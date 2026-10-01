import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('availability')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  @CaregiverScope()
  findOne(@Param('caregiverId') caregiverId: string) {
    return this.availabilityService.findOne(caregiverId);
  }

  @Put()
  @CaregiverScope()
  @Audit({ action: 'UPDATE_AVAILABILITY', entityType: 'Availability' })
  upsert(@Param('caregiverId') caregiverId: string, @Body() dto: UpsertAvailabilityDto) {
    return this.availabilityService.upsert(caregiverId, dto);
  }
}
