import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExperiencesService } from './experiences.service';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('experiences')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/experiences')
export class ExperiencesController {
  constructor(private readonly experiencesService: ExperiencesService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.experiencesService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ADD_EXPERIENCE', entityType: 'Experience' })
  create(@Param('caregiverId') caregiverId: string, @Body() dto: CreateExperienceDto) {
    return this.experiencesService.create(caregiverId, dto);
  }

  @Patch(':id')
  @CaregiverScope()
  @Audit({ action: 'UPDATE_EXPERIENCE', entityType: 'Experience' })
  update(@Param('caregiverId') caregiverId: string, @Param('id') id: string, @Body() dto: Partial<CreateExperienceDto>) {
    return this.experiencesService.update(caregiverId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_EXPERIENCE', entityType: 'Experience' })
  remove(@Param('caregiverId') caregiverId: string, @Param('id') id: string) {
    return this.experiencesService.remove(caregiverId, id);
  }
}
