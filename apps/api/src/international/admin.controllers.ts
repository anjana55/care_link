import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdminRecordsService } from './admin-records.service';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { AdminCreateEmployerDto, AdminEditEmployerDto, EnrolCaregiverDto, StaffEnquiryDto } from './dto/admin.dto';

/**
 * Create, edit and delete for Overseas records that had none (see
 * AdminRecordsService). Admins only, except signing a caregiver up for a
 * programme, which is day-to-day work for staff too. Everything is audited.
 */
@ApiTags('international')
@ApiBearerAuth()
@Controller('international')
export class AdminOverseasController {
  constructor(
    private readonly records: AdminRecordsService,
    private readonly enquiries: EmployerEnquiriesService,
  ) {}

  @Post('enquiries')
  @Roles('ADMIN')
  @Audit({ action: 'CREATE_EMPLOYER_ENQUIRY', entityType: 'EmployerEnquiry' })
  createEnquiry(@Body() dto: StaffEnquiryDto) {
    return this.enquiries.createByStaff(dto);
  }

  @Delete('enquiries/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_EMPLOYER_ENQUIRY', entityType: 'EmployerEnquiry' })
  deleteEnquiry(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteEnquiry(id);
  }

  @Post('employers')
  @Roles('ADMIN')
  @Audit({ action: 'CREATE_EMPLOYER', entityType: 'Employer' })
  createEmployer(@Body() dto: AdminCreateEmployerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.records.createEmployer(dto, user.userId);
  }

  @Put('employers/:id')
  @Roles('ADMIN')
  @Audit({ action: 'UPDATE_EMPLOYER', entityType: 'Employer' })
  editEmployer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminEditEmployerDto) {
    return this.records.editEmployer(id, dto);
  }

  @Delete('employers/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_EMPLOYER', entityType: 'Employer' })
  deleteEmployer(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteEmployer(id);
  }

  @Delete('candidates/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_CANDIDATE', entityType: 'EnquiryCandidate' })
  deleteCandidate(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteCandidate(id);
  }

  @Delete('vacancies/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_VACANCY', entityType: 'OverseasVacancy' })
  deleteVacancy(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteVacancy(id);
  }

  @Delete('interviews/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_INTERVIEW', entityType: 'CandidateInterview' })
  deleteInterview(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteInterview(id);
  }

  @Delete('offers/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_JOB_OFFER', entityType: 'JobOffer' })
  deleteOffer(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteOffer(id);
  }

  @Delete('placements/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_PLACEMENT', entityType: 'Placement' })
  deletePlacement(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deletePlacement(id);
  }

  @Delete('welfare/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_WELFARE_REPORT', entityType: 'WelfareReport' })
  deleteWelfare(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteWelfareReport(id);
  }

  @Delete('training/programmes/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_TRAINING_PROGRAMME', entityType: 'TrainingProgramme' })
  deleteProgramme(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteProgramme(id);
  }

  @Post('training/programmes/:id/enrolments')
  @Roles('ADMIN', 'STAFF')
  @Audit({ action: 'ENROL_CAREGIVER', entityType: 'TrainingProgramme' })
  enrol(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnrolCaregiverDto) {
    return this.records.enrol(id, dto);
  }

  @Delete('training/enrolments/:id')
  @Roles('ADMIN')
  @Audit({ action: 'DELETE_TRAINING_ENROLMENT', entityType: 'TrainingEnrolment' })
  deleteEnrolment(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.deleteEnrolment(id);
  }
}
