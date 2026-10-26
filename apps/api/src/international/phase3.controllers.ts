import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CaregiverScope } from '../common/decorators/caregiver-scope.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { PayhereNotification } from '../billing/payhere';
import { employerIdOf } from './employers.service';
import { VacanciesService } from './vacancies.service';
import { PlacementsService } from './placements.service';
import { PlacementInvoicesService } from './placement-invoices.service';
import { DocumentExpiryService } from './document-expiry.service';
import {
  ApplyVacancyDto,
  ExpiringDocumentsQueryDto,
  PlacementInvoiceDto,
  PlacementInvoiceQueryDto,
  PlacementPaymentDto,
  PlacementQueryDto,
  ReviewVacancyDto,
  StaffVacancyDto,
  StaffVacancyQueryDto,
  UpdateApplicationDto,
  UpdateCheckinDto,
  UpdatePlacementDto,
  UpdatePlacementInvoiceDto,
  VacancyDto,
  VacancyQueryDto,
  VoidPlacementInvoiceDto,
} from './dto/phase3.dto';

/** The public vacancy board. Anonymous; never names the employer. */
@ApiTags('international (public)')
@Controller('public/vacancies')
export class PublicVacanciesController {
  constructor(private readonly vacancies: VacanciesService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  list(@Query() query: VacancyQueryDto) {
    return this.vacancies.publicList(query);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':reference')
  one(@Param('reference') reference: string) {
    if (!/^VC-[A-Z0-9]{6}$/i.test(reference)) throw new BadRequestException('Vacancy not found');
    return this.vacancies.publicGet(reference);
  }
}

/** A caregiver's applications, placements and dated documents. Staff may act for them on the phone. */
@ApiTags('international (caregiver)')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId')
export class CaregiverOverseasController {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly placements: PlacementsService,
    private readonly expiry: DocumentExpiryService,
  ) {}

  @Get('vacancy-applications')
  @CaregiverScope()
  applications(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.vacancies.applicationsFor(caregiverId);
  }

  @Post('vacancies/:reference/apply')
  @CaregiverScope('ADMIN', 'STAFF')
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Audit({ action: 'APPLY_VACANCY', entityType: 'OverseasVacancy' })
  apply(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('reference') reference: string, @Body() dto: ApplyVacancyDto) {
    return this.vacancies.apply(caregiverId, reference, dto);
  }

  @Delete('vacancy-applications/:id')
  @CaregiverScope('ADMIN', 'STAFF')
  @Audit({ action: 'WITHDRAW_VACANCY_APPLICATION', entityType: 'VacancyApplication' })
  withdraw(@Param('caregiverId', ParseUUIDPipe) caregiverId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.vacancies.withdraw(caregiverId, id);
  }

  @Get('overseas/placements')
  @CaregiverScope()
  placementsFor(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.placements.forCaregiver(caregiverId);
  }

  @Get('overseas/documents')
  @CaregiverScope()
  documents(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return this.expiry.forCaregiver(caregiverId);
  }
}

/** The employer's vacancies, placements and invoices. Everything works on the employer the login owns. */
@ApiTags('international (employer)')
@ApiBearerAuth()
@Roles('EMPLOYER')
@Controller('employer')
export class EmployerPhase3Controller {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly placements: PlacementsService,
    private readonly invoices: PlacementInvoicesService,
  ) {}

  @Get('vacancies')
  vacancyList(@CurrentUser() user: AuthenticatedUser) {
    return this.vacancies.listForEmployer(employerIdOf(user));
  }

  @Post('vacancies')
  @Throttle({ default: { limit: 10, ttl: 60 * 60_000 } })
  @Audit({ action: 'POST_VACANCY', entityType: 'OverseasVacancy' })
  createVacancy(@CurrentUser() user: AuthenticatedUser, @Body() dto: VacancyDto) {
    return this.vacancies.createForEmployer(employerIdOf(user), dto, user.userId);
  }

  @Put('vacancies/:id')
  @Audit({ action: 'UPDATE_VACANCY', entityType: 'OverseasVacancy' })
  updateVacancy(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VacancyDto) {
    return this.vacancies.updateForEmployer(employerIdOf(user), id, dto);
  }

  @Post('vacancies/:id/close')
  @HttpCode(200)
  @Audit({ action: 'CLOSE_VACANCY', entityType: 'OverseasVacancy' })
  closeVacancy(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vacancies.closeForEmployer(employerIdOf(user), id);
  }

  @Get('placements')
  placementList(@CurrentUser() user: AuthenticatedUser, @Query('locale') locale?: string) {
    return this.placements.forEmployer(employerIdOf(user), locale);
  }

  @Get('invoices')
  invoiceList(@CurrentUser() user: AuthenticatedUser) {
    return this.invoices.listForEmployer(employerIdOf(user));
  }

  @Get('invoices/:id')
  invoice(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.getForEmployer(employerIdOf(user), id);
  }

  @Post('invoices/:id/payhere')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'START_PLACEMENT_PAYMENT', entityType: 'PlacementInvoice' })
  payOnline(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.checkout(employerIdOf(user), id, user.userId);
  }
}

/** Staff: vacancies, placements, placement invoices and expiring documents. */
@ApiTags('international (staff)')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('international')
export class StaffOverseasPhase3Controller {
  constructor(
    private readonly vacancies: VacanciesService,
    private readonly placements: PlacementsService,
    private readonly invoices: PlacementInvoicesService,
    private readonly expiry: DocumentExpiryService,
  ) {}

  // --- vacancies ---------------------------------------------------------------

  @Get('vacancies')
  vacancyList(@Query() query: StaffVacancyQueryDto) {
    return this.vacancies.staffList(query);
  }

  @Post('vacancies')
  @Audit({ action: 'POST_VACANCY', entityType: 'OverseasVacancy' })
  createVacancy(@Body() dto: StaffVacancyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vacancies.createByStaff(dto, user.userId);
  }

  @Patch('vacancy-applications/:id')
  @Audit({ action: 'UPDATE_VACANCY_APPLICATION', entityType: 'VacancyApplication' })
  updateApplication(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApplicationDto) {
    return this.vacancies.updateApplication(id, dto);
  }

  @Get('vacancies/:id')
  vacancy(@Param('id', ParseUUIDPipe) id: string) {
    return this.vacancies.staffGet(id);
  }

  @Put('vacancies/:id')
  @Audit({ action: 'UPDATE_VACANCY', entityType: 'OverseasVacancy' })
  updateVacancy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VacancyDto) {
    return this.vacancies.updateByStaff(id, dto);
  }

  @Patch('vacancies/:id/review')
  @Audit({ action: 'REVIEW_VACANCY', entityType: 'OverseasVacancy' })
  reviewVacancy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewVacancyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vacancies.review(id, dto, user.userId);
  }

  @Get('vacancies/:id/applications')
  applications(@Param('id', ParseUUIDPipe) id: string) {
    return this.vacancies.applications(id);
  }

  // --- placements ---------------------------------------------------------------

  @Get('placements')
  placementList(@Query() query: PlacementQueryDto) {
    return this.placements.staffList(query);
  }

  @Get('placements/:id')
  placement(@Param('id', ParseUUIDPipe) id: string) {
    return this.placements.staffGet(id);
  }

  @Patch('placements/:id')
  @Audit({ action: 'UPDATE_PLACEMENT', entityType: 'Placement' })
  updatePlacement(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlacementDto) {
    return this.placements.update(id, dto);
  }

  @Patch('placements/:id/checkins/:checkinId')
  @Audit({ action: 'RECORD_WELFARE_CHECKIN', entityType: 'Placement' })
  checkin(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('checkinId', ParseUUIDPipe) checkinId: string,
    @Body() dto: UpdateCheckinDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.placements.updateCheckin(id, checkinId, dto, user.userId);
  }

  // --- placement invoices ---------------------------------------------------------

  @Get('placement-invoices')
  invoiceList(@Query() query: PlacementInvoiceQueryDto) {
    return this.invoices.list(query);
  }

  @Post('placement-invoices')
  @Audit({ action: 'CREATE_PLACEMENT_INVOICE', entityType: 'PlacementInvoice' })
  createInvoice(@Body() dto: PlacementInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.create(dto, user.userId);
  }

  @Get('placement-invoices/:id')
  invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Put('placement-invoices/:id')
  @Audit({ action: 'UPDATE_PLACEMENT_INVOICE', entityType: 'PlacementInvoice' })
  updateInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlacementInvoiceDto) {
    return this.invoices.update(id, dto);
  }

  @Delete('placement-invoices/:id')
  @Audit({ action: 'DELETE_PLACEMENT_INVOICE', entityType: 'PlacementInvoice' })
  deleteInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.deleteDraft(id);
  }

  @Post('placement-invoices/:id/issue')
  @HttpCode(200)
  @Audit({ action: 'ISSUE_PLACEMENT_INVOICE', entityType: 'PlacementInvoice' })
  issue(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.issue(id);
  }

  @Post('placement-invoices/:id/void')
  @HttpCode(200)
  @Audit({ action: 'VOID_PLACEMENT_INVOICE', entityType: 'PlacementInvoice' })
  voidInvoice(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidPlacementInvoiceDto) {
    return this.invoices.void(id, dto.reason);
  }

  @Post('placement-invoices/:id/payments')
  @Audit({ action: 'RECORD_PLACEMENT_PAYMENT', entityType: 'PlacementInvoice' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlacementPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.recordPayment(id, dto, user.userId);
  }

  // --- documents --------------------------------------------------------------------

  @Get('expiring-documents')
  expiring(@Query() query: ExpiringDocumentsQueryDto) {
    return this.expiry.staffList(query.withinDays);
  }

  /** Runs today's reminders now rather than waiting for the daily sweep. Each reminder still goes out once. */
  @Post('reminders/run')
  @Roles('ADMIN')
  @HttpCode(200)
  @Audit({ action: 'RUN_EXPIRY_REMINDERS', entityType: 'Caregiver' })
  runReminders() {
    return this.expiry.sweep();
  }
}

/** Where PayHere posts the outcome of a placement-fee card payment. Verified before anything is believed. */
@Controller('payments/payhere')
export class PlacementPayhereNotifyController {
  constructor(private readonly invoices: PlacementInvoicesService) {}

  @Post('placement-notify')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async notify(@Body() body: PayhereNotification) {
    const result = await this.invoices.handleNotification(body ?? {});
    if (result === 'BAD_SIGNATURE') throw new BadRequestException('Invalid signature');
    return 'OK';
  }
}
