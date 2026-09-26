import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CaregiversService } from './caregivers.service';
import { CreateCaregiverDto } from './dto/create-caregiver.dto';
import { UpdateCaregiverDto } from './dto/update-caregiver.dto';
import { CaregiverQueryDto } from './dto/caregiver-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('caregivers')
@ApiBearerAuth()
@Controller('caregivers')
export class CaregiversController {
  constructor(private readonly caregiversService: CaregiversService) {}

  // Staff-only: aggregate stats and the full caregiver list/search are an
  // operations view, not something a caregiver's own login should see.
  @Get('dashboard')
  @Roles('ADMIN', 'STAFF', 'VERIFIER')
  dashboard() {
    return this.caregiversService.dashboardStats();
  }

  @Get()
  @Roles('ADMIN', 'STAFF', 'VERIFIER')
  findAll(@Query() query: CaregiverQueryDto) {
    return this.caregiversService.findAll(query);
  }

  @Get(':id')
  @CaregiverScope()
  @Audit({ action: 'VIEW_CAREGIVER', entityType: 'Caregiver' })
  findOne(@Param('id') id: string) {
    return this.caregiversService.findOne(id);
  }

  // Staff-mediated creation. Self-registration is a separate, public flow
  // (POST /auth/register-caregiver) that also creates the login account -
  // it doesn't go through this staff-only endpoint.
  @Post()
  @Roles('ADMIN', 'STAFF')
  @Audit({ action: 'CREATE_CAREGIVER', entityType: 'Caregiver' })
  create(@Body() dto: CreateCaregiverDto) {
    return this.caregiversService.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  @Audit({ action: 'UPDATE_CAREGIVER', entityType: 'Caregiver' })
  update(@Param('id') id: string, @Body() dto: UpdateCaregiverDto) {
    return this.caregiversService.update(id, dto);
  }

  // A caregiver may submit their own DRAFT -> REGISTERED; every other
  // transition (verification, activation, suspension...) stays staff/
  // verifier-only. That distinction is enforced in the service, not here,
  // since it depends on the *current* status, not just who's asking.
  @Patch(':id/status')
  @CaregiverScope('ADMIN', 'VERIFIER')
  @Audit({ action: 'UPDATE_CAREGIVER_STATUS', entityType: 'Caregiver' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.caregiversService.updateStatus(id, dto.status, user.role);
  }

  @Delete(':id')
  @Roles('ADMIN', 'STAFF')
  @Audit({ action: 'DELETE_CAREGIVER', entityType: 'Caregiver' })
  remove(@Param('id') id: string) {
    return this.caregiversService.remove(id);
  }
}
