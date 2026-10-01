import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { HealthInformationService } from './health-information.service';
import { UpsertHealthInformationDto } from './dto/upsert-health-information.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

// A caregiver is the subject of this data and may view/edit their own -
// only ADMIN may access this sensitive data.
@ApiTags('health-information')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/health-information')
@CaregiverScope('ADMIN')
export class HealthInformationController {
  constructor(private readonly healthInformationService: HealthInformationService) {}

  @Get()
  findOne(@Param('caregiverId') caregiverId: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.healthInformationService.findOne(caregiverId, user.userId, req.ip);
  }

  @Put()
  upsert(
    @Param('caregiverId') caregiverId: string,
    @Body() dto: UpsertHealthInformationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.healthInformationService.upsert(caregiverId, dto, user.userId, req.ip);
  }
}
