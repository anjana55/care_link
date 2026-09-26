import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { QualificationsService } from './qualifications.service';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('qualifications')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/qualifications')
export class QualificationsController {
  constructor(private readonly qualificationsService: QualificationsService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.qualificationsService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ADD_QUALIFICATION', entityType: 'Qualification' })
  create(@Param('caregiverId') caregiverId: string, @Body() dto: CreateQualificationDto) {
    return this.qualificationsService.create(caregiverId, dto);
  }

  @Patch(':id')
  @CaregiverScope()
  @Audit({ action: 'UPDATE_QUALIFICATION', entityType: 'Qualification' })
  update(@Param('caregiverId') caregiverId: string, @Param('id') id: string, @Body() dto: Partial<CreateQualificationDto>) {
    return this.qualificationsService.update(caregiverId, id, dto);
  }

  // Verification stays staff/verifier-only, regardless of ownership - a
  // caregiver can add and edit their own qualification records, but cannot
  // mark them verified.
  @Patch(':id/verification')
  @Roles('ADMIN', 'VERIFIER')
  @Audit({ action: 'VERIFY_QUALIFICATION', entityType: 'Qualification' })
  setVerification(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED',
  ) {
    return this.qualificationsService.setVerificationStatus(caregiverId, id, status);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_QUALIFICATION', entityType: 'Qualification' })
  remove(@Param('caregiverId') caregiverId: string, @Param('id') id: string) {
    return this.qualificationsService.remove(caregiverId, id);
  }
}
