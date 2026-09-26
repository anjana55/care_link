import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReferencesService } from './references.service';
import { CreateReferenceDto } from './dto/create-reference.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('references')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/references')
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.referencesService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ADD_REFERENCE', entityType: 'Reference' })
  create(@Param('caregiverId') caregiverId: string, @Body() dto: CreateReferenceDto) {
    return this.referencesService.create(caregiverId, dto);
  }

  @Patch(':id/verification')
  @Roles('ADMIN', 'VERIFIER')
  @Audit({ action: 'VERIFY_REFERENCE', entityType: 'Reference' })
  setVerification(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED',
  ) {
    return this.referencesService.setVerificationStatus(caregiverId, id, status);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_REFERENCE', entityType: 'Reference' })
  remove(@Param('caregiverId') caregiverId: string, @Param('id') id: string) {
    return this.referencesService.remove(caregiverId, id);
  }
}
