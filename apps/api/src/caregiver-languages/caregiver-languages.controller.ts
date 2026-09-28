import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CaregiverLanguagesService } from './caregiver-languages.service';
import { AssignLanguageDto } from './dto/assign-language.dto';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';

@ApiTags('caregiver-languages')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/languages')
export class CaregiverLanguagesController {
  constructor(private readonly caregiverLanguagesService: CaregiverLanguagesService) {}

  @Get()
  @CaregiverScope()
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.caregiverLanguagesService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @CaregiverScope()
  @Audit({ action: 'ASSIGN_LANGUAGE', entityType: 'Caregiver' })
  assign(@Param('caregiverId') caregiverId: string, @Body() dto: AssignLanguageDto) {
    return this.caregiverLanguagesService.assign(caregiverId, dto);
  }

  @Delete(':languageId')
  @CaregiverScope()
  @Audit({ action: 'REMOVE_LANGUAGE', entityType: 'Caregiver' })
  remove(@Param('caregiverId') caregiverId: string, @Param('languageId') languageId: string) {
    return this.caregiverLanguagesService.remove(caregiverId, languageId);
  }
}
