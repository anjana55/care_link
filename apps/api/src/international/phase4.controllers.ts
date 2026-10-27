import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CERTIFICATE_CODE_PATTERN, departureItemValues, type DepartureItem } from '@care-platform/shared';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { employerIdOf } from './employers.service';
import { TrainingService } from './training.service';
import { AssessmentsService } from './assessments.service';
import { InterviewsService } from './interviews.service';
import { OffersService } from './offers.service';
import { JourneyService } from './journey.service';
import { WelfareService } from './welfare.service';
import { PlacementsService } from './placements.service';
import { ReportsService } from './reports.service';
import { clientIp } from './codes';
import {
  AssessmentDto,
  ContactAbroadDto,
  InterviewDto,
  InterviewFeedbackDto,
  InterviewQueryDto,
  OfferDto,
  OfferQueryDto,
  ReportQueryDto,
  RespondOfferDto,
  ReviewOfferDto,
  RevokeCertificateDto,
  StaffAssessmentQueryDto,
  UpdateChecklistItemDto,
  UpdateInterviewDto,
  VerifyAssessmentDto,
  WelfareMessageDto,
  WelfareQueryDto,
  WelfareReportDto,
  WelfareStatusDto,
} from './dto/phase4.dto';

/** The check behind the code on a certificate. Anonymous; first name only. */
@ApiTags('international (public)')
@Controller('public/certificates')
export class PublicCertificatesController {
  constructor(private readonly training: TrainingService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':code')
  check(@Param('code') code: string) {
    if (!CERTIFICATE_CODE_PATTERN.test(code.toUpperCase())) throw new BadRequestException('Certificate not found');
    return this.training.checkCertificate(code);
  }
}

/** A caregiver's test results, interviews, offers, contact abroad and welfare reports. */
@ApiTags('international (caregiver)')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/overseas')
export class CaregiverPhase4Controller {
  constructor(
    private readonly assessments: AssessmentsService,
    private readonly interviews: InterviewsService,
    private readonly offers: OffersService,
    private readonly journey: JourneyService,
    private readonly welfare: WelfareService,
    private readonly placements: PlacementsService,
  ) {}

  @Get('assessments')
  @CaregiverScope()
  assessmentList(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.assessments.forCaregiver(caregiverId);
  }

  @Post('assessments')
  @CaregiverScope('ADMIN', 'STAFF')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Audit({ action: 'ADD_ASSESSMENT', entityType: 'CaregiverAssessment' })
  addAssessment(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: AssessmentDto) {
    return this.assessments.addByCaregiver(caregiverId, dto);
  }

  @Delete('assessments/:id')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'REMOVE_ASSESSMENT', entityType: 'CaregiverAssessment' })
  removeAssessment(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.assessments.removeByCaregiver(caregiverId, id);
  }

  @Get('interviews')
  @CaregiverScope()
  interviewList(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.interviews.forCaregiver(caregiverId);
  }

  @Get('offers')
  @CaregiverScope()
  offerList(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.offers.forCaregiver(caregiverId);
  }

  /** Only the caregiver can sign: the service refuses staff, even though the scope lets staff read. */
  @Post('offers/:id/respond')
  @CaregiverScope()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @Audit({ action: 'RESPOND_JOB_OFFER', entityType: 'JobOffer' })
  respond(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondOfferDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.offers.respond(caregiverId, id, dto, { role: user.role, ip: clientIp(req) });
  }

  @Put('placements/:placementId/contact')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'UPDATE_CONTACT_ABROAD', entityType: 'Placement' })
  async contact(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('placementId', ParseUUIDPipe) placementId: string, @Body() dto: ContactAbroadDto) {
    await this.journey.updateContact(caregiverId, placementId, dto);
    return this.placements.forCaregiver(caregiverId);
  }

  @Get('welfare')
  @CaregiverScope()
  welfareList(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.welfare.forCaregiver(caregiverId);
  }

  @Post('placements/:placementId/welfare')
  @CaregiverScope('ADMIN', 'STAFF')
  @Throttle({ default: { limit: 30, ttl: 60 * 60_000 } })
  @Audit({ action: 'REPORT_WELFARE', entityType: 'WelfareReport' })
  report(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
    @Param('placementId', ParseUUIDPipe) placementId: string,
    @Body() dto: WelfareReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.welfare.create(caregiverId, placementId, dto, user.userId);
  }

  @Post('welfare/:id/messages')
  @CaregiverScope('ADMIN', 'STAFF')
  @Throttle({ default: { limit: 60, ttl: 60 * 60_000 } })
  welfareMessage(
    @Param('caregiverId', ParseUUIDPipe) caregiverId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WelfareMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.welfare.caregiverMessage(caregiverId, id, dto, user.userId);
  }
}

/** The employer's interview feedback and job offers. */
@ApiTags('international (employer)')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller('employer')
export class EmployerPhase4Controller {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly offers: OffersService,
  ) {}

  @Patch('interviews/:id/feedback')
  @Audit({ action: 'INTERVIEW_FEEDBACK', entityType: 'CandidateInterview' })
  feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InterviewFeedbackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.recordFeedback(employerIdOf(user), id, dto.feedback);
  }

  @Get('offers')
  offerList(@CurrentUser() user: AuthenticatedUser) {
    return this.offers.employerList(employerIdOf(user));
  }

  @Get('offers/:id')
  offer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.employerGet(employerIdOf(user), id);
  }

  @Post('candidates/:id/offers')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Audit({ action: 'MAKE_JOB_OFFER', entityType: 'JobOffer' })
  makeOffer(@Param('id', ParseUUIDPipe) candidateId: string, @Body() dto: OfferDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.offers.create(employerIdOf(user), candidateId, dto, { userId: user.userId, ip: clientIp(req) });
  }

  @Put('offers/:id')
  @Audit({ action: 'UPDATE_JOB_OFFER', entityType: 'JobOffer' })
  updateOffer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OfferDto, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.offers.updateByEmployer(employerIdOf(user), id, dto, { userId: user.userId, ip: clientIp(req) });
  }

  @Post('offers/:id/withdraw')
  @HttpCode(200)
  @Audit({ action: 'WITHDRAW_JOB_OFFER', entityType: 'JobOffer' })
  withdrawOffer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.withdraw(employerIdOf(user), id);
  }
}

/** Staff: test results, certificates, interviews, offers, departure, welfare and reports. */
@ApiTags('international (staff)')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('international')
export class StaffPhase4Controller {
  constructor(
    private readonly training: TrainingService,
    private readonly assessments: AssessmentsService,
    private readonly interviews: InterviewsService,
    private readonly offers: OffersService,
    private readonly journey: JourneyService,
    private readonly welfare: WelfareService,
    private readonly placements: PlacementsService,
    private readonly reports: ReportsService,
  ) {}

  // --- test results and certificates ------------------------------------------------------

  @Get('assessments')
  assessmentList(@Query() query: StaffAssessmentQueryDto) {
    return this.assessments.staffList(query);
  }

  @Post('caregivers/:caregiverId/assessments')
  @Audit({ action: 'RECORD_ASSESSMENT', entityType: 'CaregiverAssessment' })
  recordAssessment(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: AssessmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.createByStaff(caregiverId, dto, user.userId);
  }

  @Put('assessments/:id')
  @Audit({ action: 'UPDATE_ASSESSMENT', entityType: 'CaregiverAssessment' })
  updateAssessment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssessmentDto) {
    return this.assessments.updateByStaff(id, dto);
  }

  @Patch('assessments/:id/verify')
  @Audit({ action: 'VERIFY_ASSESSMENT', entityType: 'CaregiverAssessment' })
  verifyAssessment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyAssessmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.assessments.verify(id, dto.verified, user.userId);
  }

  @Delete('assessments/:id')
  @HttpCode(204)
  @Audit({ action: 'DELETE_ASSESSMENT', entityType: 'CaregiverAssessment' })
  async deleteAssessment(@Param('id', ParseUUIDPipe) id: string) {
    await this.assessments.remove(id);
  }

  @Post('certificates/:id/revoke')
  @HttpCode(200)
  @Audit({ action: 'REVOKE_CERTIFICATE', entityType: 'TrainingCertificate' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeCertificateDto) {
    return this.training.revokeCertificate(id, dto.reason);
  }

  // --- interviews ------------------------------------------------------------------------------

  @Get('interviews')
  interviewList(@Query() query: InterviewQueryDto) {
    return this.interviews.staffList(query);
  }

  @Post('candidates/:id/interviews')
  @Audit({ action: 'SCHEDULE_INTERVIEW', entityType: 'CandidateInterview' })
  schedule(@Param('id', ParseUUIDPipe) candidateId: string, @Body() dto: InterviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviews.schedule(candidateId, dto, user.userId);
  }

  @Patch('interviews/:id')
  @Audit({ action: 'UPDATE_INTERVIEW', entityType: 'CandidateInterview' })
  updateInterview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInterviewDto) {
    return this.interviews.update(id, dto);
  }

  // --- offers -------------------------------------------------------------------------------------

  @Get('offers')
  offerList(@Query() query: OfferQueryDto) {
    return this.offers.staffList(query);
  }

  @Get('offers/:id')
  offer(@Param('id', ParseUUIDPipe) id: string) {
    return this.offers.staffGet(id);
  }

  @Patch('offers/:id/review')
  @Audit({ action: 'REVIEW_JOB_OFFER', entityType: 'JobOffer' })
  reviewOffer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewOfferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.offers.review(id, dto, user.userId);
  }

  // --- departure -------------------------------------------------------------------------------------

  @Patch('placements/:id/checklist/:item')
  @Audit({ action: 'UPDATE_DEPARTURE_CHECKLIST', entityType: 'Placement' })
  async checklist(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('item') item: string,
    @Body() dto: UpdateChecklistItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!(departureItemValues as readonly string[]).includes(item)) throw new BadRequestException('Unknown checklist item');
    await this.journey.updateItem(id, item as DepartureItem, dto, user.userId);
    return this.placements.staffGet(id);
  }

  // --- welfare ---------------------------------------------------------------------------------------------

  @Get('welfare')
  welfareList(@Query() query: WelfareQueryDto) {
    return this.welfare.staffList(query);
  }

  @Get('welfare/:id')
  welfareReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.welfare.staffGet(id);
  }

  @Post('welfare/:id/messages')
  @Audit({ action: 'REPLY_WELFARE', entityType: 'WelfareReport' })
  reply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WelfareMessageDto, @CurrentUser() user: AuthenticatedUser) {
    return this.welfare.staffMessage(id, dto, user.userId);
  }

  @Patch('welfare/:id/status')
  @Audit({ action: 'UPDATE_WELFARE_STATUS', entityType: 'WelfareReport' })
  welfareStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WelfareStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.welfare.setStatus(id, dto.status, user.userId);
  }

  // --- reports ------------------------------------------------------------------------------------------------

  @Get('reports')
  report(@Query() query: ReportQueryDto) {
    return this.reports.report(query);
  }
}
