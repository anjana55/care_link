import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ExperiencesService } from './experiences.service';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

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

  // Office staff and verifiers read the work history; an admin (or the
  // caregiver, for their own) changes it. Staff may add entries only while
  // registering a caregiver (a DRAFT) - the service checks that.
  @Post()
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'ADD_EXPERIENCE', entityType: 'Experience' })
  create(@Param('caregiverId') caregiverId: string, @Body() dto: CreateExperienceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.experiencesService.create(caregiverId, dto, user.role);
  }

  @Patch(':id')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'UPDATE_EXPERIENCE', entityType: 'Experience' })
  update(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExperienceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.experiencesService.update(caregiverId, id, dto, user.role);
  }

  // Admin as before (staff only on a DRAFT, see create); a caregiver may also withdraw their own entry while it is
  // still unchecked (the service enforces that - the guard only knows ownership).
  @Delete(':id')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'DELETE_EXPERIENCE', entityType: 'Experience' })
  remove(@Param('caregiverId') caregiverId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.experiencesService.remove(caregiverId, id, user.role);
  }
}
