import { Body, Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { PatientQueryDto } from './dto/patient-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
// Staff and admin only. VERIFIER is deliberately excluded: verification is
// caregiver-credential work, and the caregiver module is the only thing they
// need. A PATIENT_GUARDIAN login gets 403 here - this is an operations view.
@Roles('ADMIN', 'STAFF')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Get()
  findAll(@Query() query: PatientQueryDto) {
    return this.patientsService.findAll(query);
  }

  @Get(':id')
  @Audit({ action: 'VIEW_CLIENT', entityType: 'Patient' })
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  @Patch(':id/status')
  @Audit({ action: 'UPDATE_CLIENT_STATUS', entityType: 'Patient' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.patientsService.updateStatus(id, dto);
  }

  // Account-level activate/deactivate is admin-only: it gates a real
  // person's ability to sign in, so staff get read + status review only.
  @Patch(':id/active')
  @Roles('ADMIN')
  @Audit({ action: 'UPDATE_CLIENT_ACCOUNT_STATUS', entityType: 'Patient' })
  setActive(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.patientsService.setActive(id, isActive);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_CLIENT', entityType: 'Patient' })
  remove(@Param('id') id: string) {
    return this.patientsService.remove(id);
  }
}