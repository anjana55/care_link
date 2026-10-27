import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PatientsService } from './patients.service';
import { PatientQueryDto } from './dto/patient-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { AdminPasswordResetDto } from '../auth/dto/password-reset.dto';

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patients')
// Staff and admin only. VERIFIER is deliberately excluded: verification is
// caregiver-credential work, and the caregiver module is the only thing they
// need. A PATIENT_GUARDIAN login gets 403 here - this is an operations view.
@Roles('ADMIN', 'STAFF')
export class PatientsController {
  constructor(
    private readonly patientsService: PatientsService,
    private readonly passwordReset: PasswordResetService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  findAll(@Query() query: PatientQueryDto) {
    return this.patientsService.findAll(query);
  }

  @Get(':id')
  @Audit({ action: 'VIEW_CLIENT', entityType: 'Patient' })
  findOne(@Param('id') id: string) {
    return this.patientsService.findOne(id);
  }

  // Staff and admin, inherited from the class-level @Roles: the same
  // operations view that can already read and review a client. Deliberately
  // not narrowed to ADMIN the way :id/active is - that one gates a real
  // person's ability to sign in, whereas this corrects the data attached to
  // the account. (The phone it writes IS the WhatsApp login number, but
  // writing it grants nothing: the new number has to complete an OTP before
  // phoneVerifiedAt is set again.)
  @Patch(':id')
  @Audit({ action: 'UPDATE_CLIENT', entityType: 'Patient' })
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientsService.update(id, dto);
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

  /**
   * Admin only, like :id/active: email the client a link to set a new
   * password, or set one to hand over. Audited without the password.
   */
  @Post(':id/password')
  @Roles('ADMIN')
  async password(@Param('id') id: string, @Body() dto: AdminPasswordResetDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const client = await this.patientsService.findOne(id);
    const result =
      dto.mode === 'SEND_LINK'
        ? { mode: dto.mode, ...(await this.passwordReset.sendLinkFor(client.userId, user.userId)) }
        : { mode: dto.mode, ...(await this.passwordReset.setPasswordFor(client.userId, dto.newPassword)) };
    await this.audit.record({
      userId: user.userId,
      action: dto.mode === 'SEND_LINK' ? 'SEND_CLIENT_PASSWORD_LINK' : 'SET_CLIENT_PASSWORD',
      entityType: 'Patient',
      entityId: id,
      metadata: { email: result.email },
      ipAddress: req.ip,
    });
    return result;
  }
}
