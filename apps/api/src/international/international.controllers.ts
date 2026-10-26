import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { InternationalSummary, OverseasStaffSummary } from '@care-platform/shared';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { OverseasReadinessService } from './overseas-readiness.service';
import { SharedProfilesService } from './shared-profiles.service';
import { TrainingService } from './training.service';
import { ReadinessService } from './readiness.service';
import { CandidatesService } from './candidates.service';
import { EmployersService } from './employers.service';
import { MAX_PHOTO_UPLOAD_BYTES } from './profile-photo';
import {
  CreateEmployerEnquiryDto,
  EmployerEnquiryQueryDto,
  EmployerQueryDto,
  ProposeCandidateDto,
  ReviewEmployerDto,
  TalentPoolQueryDto,
  UpdateCandidateDto,
  ReviewSharedProfileDto,
  ShareProfileDto,
  SharedProfileQueryDto,
  TalentQueryDto,
  TrainingProgrammeDto,
  UpdateEmployerEnquiryDto,
  UpdateOverseasReadinessDto,
  UpdateSharedProfileDto,
  UpdateTrainingEnrolmentDto,
} from './dto/international.dto';

const SUMMARY_TTL_MS = 5 * 60 * 1000;

/**
 * The public side of the international paths. Everything here is anonymous
 * by design (see PublicSearchController for the same reasoning): tight
 * per-route throttles, counts only on the landing numbers, and shared
 * profiles only through SharedProfilesService's explicit allow-list.
 */
@ApiTags('international (public)')
@Controller('public')
export class PublicInternationalController {
  private summaryCache: { at: number; value: InternationalSummary } | null = null;

  constructor(
    private readonly enquiries: EmployerEnquiriesService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly training: TrainingService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Post('international/enquiries')
  @HttpCode(201)
  createEnquiry(@Body() dto: CreateEmployerEnquiryDto) {
    return this.enquiries.create(dto);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('international/summary')
  async summary(): Promise<InternationalSummary> {
    if (this.summaryCache && Date.now() - this.summaryCache.at < SUMMARY_TTL_MS) return this.summaryCache.value;
    const [counts, trainingCompletions] = await Promise.all([this.sharedProfiles.openToOverseasCounts(), this.training.completionCount()]);
    const value = { ...counts, trainingCompletions };
    this.summaryCache = { at: Date.now(), value };
    return value;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('training')
  trainingProgrammes(@Query('locale') locale?: string) {
    return this.training.activeProgrammes(locale);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('talent')
  talent(@Query() query: TalentQueryDto) {
    return this.sharedProfiles.directory(query);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('talent/:slug')
  talentProfile(@Param('slug') slug: string, @Query('locale') locale?: string) {
    return this.sharedProfiles.publicProfile(slug, locale);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('talent/:slug/photo')
  async talentPhoto(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, mimeType } = await this.sharedProfiles.publicPhoto(slug);
    // Short: a caregiver who pauses or withdraws expects the photo to disappear soon, not in a week.
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(buffer);
  }
}

/**
 * A caregiver's own Work abroad section. CaregiverScope: the caregiver for
 * their own record, or staff.
 */
@ApiTags('international (caregiver)')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId')
export class CaregiverInternationalController {
  constructor(
    private readonly readiness: OverseasReadinessService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly training: TrainingService,
    private readonly checklist: ReadinessService,
    private readonly candidates: CandidatesService,
  ) {}

  /** How ready the caregiver is to work abroad, item by item. */
  @Get('overseas/checklist')
  @CaregiverScope()
  getChecklist(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.checklist.forCaregiver(caregiverId);
  }

  /** Employers interested in this caregiver - the country and kind of employer only. */
  @Get('overseas/interest')
  @CaregiverScope()
  getInterest(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.candidates.interestFor(caregiverId);
  }

  @Get('overseas')
  @CaregiverScope()
  getReadiness(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.readiness.get(caregiverId);
  }

  @Put('overseas')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'UPDATE_OVERSEAS_READINESS', entityType: 'Caregiver' })
  updateReadiness(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: UpdateOverseasReadinessDto) {
    return this.readiness.update(caregiverId, dto);
  }

  @Get('training')
  @CaregiverScope()
  enrolments(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.training.enrolmentsFor(caregiverId);
  }

  @Post('training/:programmeId')
  @CaregiverScope('ADMIN', 'STAFF')
  registerInterest(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('programmeId', ParseUUIDPipe) programmeId: string) {
    return this.training.registerInterest(caregiverId, programmeId);
  }

  @Delete('training/:programmeId')
  @CaregiverScope('ADMIN', 'STAFF')
  withdrawTraining(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('programmeId', ParseUUIDPipe) programmeId: string) {
    return this.training.withdraw(caregiverId, programmeId);
  }

  @Get('shared-profile')
  @CaregiverScope()
  sharedProfile(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.sharedProfiles.settings(caregiverId);
  }

  // Consent and publishing are the caregiver's own decisions: staff can view
  // and review a shared profile, but not edit it or switch it on for them.
  @Put('shared-profile')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'UPDATE_SHARED_PROFILE', entityType: 'SharedProfile' })
  updateSharedProfile(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: UpdateSharedProfileDto) {
    return this.sharedProfiles.updateContent(caregiverId, dto);
  }

  @Post('shared-profile/share')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'SHARE_PROFILE', entityType: 'SharedProfile' })
  share(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: ShareProfileDto, @CurrentUser() user: AuthenticatedUser) {
    // Consent is personal. An admin may pause or withdraw on a caregiver's
    // behalf (say, at their request on the phone) but never give it for them.
    if (user.role !== 'CAREGIVER') throw new ForbiddenException('Only the caregiver can give consent to share their profile.');
    return this.sharedProfiles.share(caregiverId, dto);
  }

  @Post('shared-profile/unshare')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'UNSHARE_PROFILE', entityType: 'SharedProfile' })
  unshare(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.sharedProfiles.unshare(caregiverId);
  }

  @Post('shared-profile/withdraw-consent')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'WITHDRAW_PROFILE_CONSENT', entityType: 'SharedProfile' })
  withdrawConsent(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.sharedProfiles.withdrawConsent(caregiverId);
  }

  @Post('shared-profile/new-link')
  @CaregiverScope('ADMIN')
  @Audit({ action: 'REGENERATE_PROFILE_LINK', entityType: 'SharedProfile' })
  newLink(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.sharedProfiles.regenerateLink(caregiverId);
  }

  @Post('shared-profile/photo')
  @CaregiverScope('ADMIN')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES } }))
  @Audit({ action: 'UPLOAD_PROFILE_PHOTO', entityType: 'SharedProfile' })
  uploadPhoto(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @UploadedFile() file: Express.Multer.File) {
    return this.sharedProfiles.uploadPhoto(caregiverId, file);
  }

  @Delete('shared-profile/photo')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'DELETE_PROFILE_PHOTO', entityType: 'SharedProfile' })
  deletePhoto(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.sharedProfiles.deletePhoto(caregiverId);
  }

  @Get('shared-profile/photo')
  @CaregiverScope('ADMIN', 'STAFF')
  async photo(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, mimeType } = await this.sharedProfiles.photo(caregiverId);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(buffer);
  }
}

/** The staff Overseas enquiries queue. ADMIN + STAFF, like the Requests queue. */
@ApiTags('international (staff)')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('international')
export class StaffInternationalController {
  constructor(
    private readonly enquiries: EmployerEnquiriesService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly training: TrainingService,
    private readonly employers: EmployersService,
    private readonly candidates: CandidatesService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get('enquiries')
  findAll(@Query() query: EmployerEnquiryQueryDto) {
    return this.enquiries.findAll(query);
  }

  @Get('enquiries/summary')
  async summary(): Promise<OverseasStaffSummary> {
    const [enquiries, pendingProfiles, pendingEmployers, interviewRequests] = await Promise.all([
      this.enquiries.summary(),
      this.sharedProfiles.pendingCount(),
      this.employers.pendingCount(),
      this.candidates.interviewRequestCount(),
    ]);
    return { ...enquiries, pendingProfiles, pendingEmployers, interviewRequests };
  }

  @Get('enquiries/:id/candidates')
  candidatesFor(@Param('id', ParseUUIDPipe) id: string) {
    return this.candidates.listForEnquiry(id);
  }

  @Post('enquiries/:id/candidates')
  @Audit({ action: 'PROPOSE_CANDIDATE', entityType: 'EmployerEnquiry' })
  propose(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProposeCandidateDto) {
    return this.candidates.propose(id, dto);
  }

  @Patch('candidates/:id')
  @Audit({ action: 'UPDATE_CANDIDATE', entityType: 'EnquiryCandidate' })
  updateCandidate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCandidateDto) {
    return this.candidates.update(id, dto);
  }

  @Get('interview-requests')
  interviewRequests() {
    return this.candidates.interviewRequests();
  }

  @Get('employers')
  employerList(@Query() query: EmployerQueryDto) {
    return this.employers.adminList(query);
  }

  @Patch('employers/:id/review')
  @Audit({ action: 'REVIEW_EMPLOYER', entityType: 'Employer' })
  reviewEmployer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewEmployerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.employers.review(id, dto, user.userId);
  }

  @Get('talent-pool')
  talentPool(@Query() query: TalentPoolQueryDto) {
    return this.readiness.talentPool(query);
  }

  @Get('enquiries/:id')
  @Audit({ action: 'VIEW_EMPLOYER_ENQUIRY', entityType: 'EmployerEnquiry' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.enquiries.findOne(id);
  }

  @Patch('enquiries/:id')
  @Audit({ action: 'UPDATE_EMPLOYER_ENQUIRY', entityType: 'EmployerEnquiry' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployerEnquiryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.enquiries.update(id, dto, user.userId);
  }

  @Get('shared-profiles')
  sharedProfileQueue(@Query() query: SharedProfileQueryDto) {
    return this.sharedProfiles.reviewQueue(query);
  }

  @Patch('shared-profiles/:caregiverId/review')
  @Audit({ action: 'REVIEW_SHARED_PROFILE', entityType: 'SharedProfile' })
  review(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Body() dto: ReviewSharedProfileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sharedProfiles.review(caregiverId, dto, user.userId);
  }

  @Get('training/programmes')
  programmes() {
    return this.training.allProgrammes();
  }

  @Post('training/programmes')
  @Audit({ action: 'CREATE_TRAINING_PROGRAMME', entityType: 'TrainingProgramme' })
  createProgramme(@Body() dto: TrainingProgrammeDto) {
    return this.training.createProgramme(dto);
  }

  @Put('training/programmes/:id')
  @Audit({ action: 'UPDATE_TRAINING_PROGRAMME', entityType: 'TrainingProgramme' })
  updateProgramme(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TrainingProgrammeDto) {
    return this.training.updateProgramme(id, dto);
  }

  @Get('training/programmes/:id/enrolments')
  enrolments(@Param('id', ParseUUIDPipe) id: string) {
    return this.training.enrolments(id);
  }

  @Patch('training/enrolments/:id')
  @Audit({ action: 'UPDATE_TRAINING_ENROLMENT', entityType: 'TrainingEnrolment' })
  updateEnrolment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTrainingEnrolmentDto) {
    return this.training.updateEnrolment(id, dto);
  }
}
