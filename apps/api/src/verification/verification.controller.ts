import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { VerificationService } from './verification.service';
import { CreateVerificationDto, UpdateVerificationDto } from './dto/verification.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@ApiTags('verification')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/verifications')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  // A caregiver may check their own verification status; creating/updating
  // verification records is still ADMIN/VERIFIER-only below.
  @Get()
  @CaregiverScope('ADMIN', 'VERIFIER')
  findAll(@Param('caregiverId') caregiverId: string) {
    return this.verificationService.findAllForCaregiver(caregiverId);
  }

  @Post()
  @Roles('ADMIN', 'VERIFIER')
  @Audit({ action: 'CREATE_VERIFICATION', entityType: 'Verification' })
  create(@Param('caregiverId') caregiverId: string, @Body() dto: CreateVerificationDto) {
    return this.verificationService.create(caregiverId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'VERIFIER')
  @Audit({ action: 'UPDATE_VERIFICATION', entityType: 'Verification' })
  update(
    @Param('caregiverId') caregiverId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVerificationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.verificationService.update(caregiverId, id, dto, user.userId);
  }
}
