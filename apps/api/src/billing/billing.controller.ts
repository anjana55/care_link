import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AddCareRequestNoteDto } from '../care-requests/dto/update-care-request-status.dto';
import { BillingSettingsService } from './billing-settings.service';
import { InvoicesService } from './invoices.service';
import { PayoutsService } from './payouts.service';
import { PayhereService } from './payhere.service';
import type { PayhereNotification } from './payhere';
import { UpdateBillingSettingsDto } from './dto/billing-settings.dto';
import {
  CreateInvoiceDto,
  CreatePayoutDto,
  GeneratePayoutsDto,
  InvoiceQueryDto,
  IssueInvoiceDto,
  PayPayoutDto,
  PayhereCheckoutDto,
  PayoutQueryDto,
  ReasonDto,
  RecordPaymentDto,
  ReplaceLinesDto,
  UpdateInvoiceDto,
  UpdatePayoutDto,
} from './dto/billing.dto';

/** Admin-only: who invoices are from, tax, numbering, and the PayHere merchant. */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/billing')
@Roles('ADMIN')
export class BillingSettingsController {
  constructor(private readonly settings: BillingSettingsService) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_BILLING_SETTINGS', entityType: 'BillingSettings' })
  update(@Body() dto: UpdateBillingSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }
}

/** Staff invoicing. ADMIN and STAFF, like Bookings. */
@ApiTags('invoices')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  findAll(@Query() query: InvoiceQueryDto) {
    return this.invoices.findAll(query);
  }

  @Get('summary')
  summary() {
    return this.invoices.summary();
  }

  @Post()
  @Audit({ action: 'CREATE_INVOICE', entityType: 'Invoice' })
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.create(dto, user);
  }

  @Get(':id')
  @Audit({ action: 'VIEW_INVOICE', entityType: 'Invoice' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findOne(id);
  }

  @Patch(':id')
  @Audit({ action: 'UPDATE_INVOICE', entityType: 'Invoice' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.update(id, dto, user);
  }

  @Delete(':id')
  @Audit({ action: 'DELETE_INVOICE', entityType: 'Invoice' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.remove(id, user);
  }

  @Put(':id/lines')
  @Audit({ action: 'UPDATE_INVOICE_LINES', entityType: 'Invoice' })
  replaceLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceLinesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.replaceLines(id, dto, user);
  }

  @Post(':id/lines/from-shifts')
  @HttpCode(200)
  @Audit({ action: 'UPDATE_INVOICE_LINES', entityType: 'Invoice' })
  addShiftLines(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.addShiftLines(id, user);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @Audit({ action: 'ISSUE_INVOICE', entityType: 'Invoice' })
  issue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IssueInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.issue(id, dto, user);
  }

  @Post(':id/send')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'SEND_INVOICE', entityType: 'Invoice' })
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.send(id, user);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Audit({ action: 'VOID_INVOICE', entityType: 'Invoice' })
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.void(id, dto.reason, user);
  }

  @Post(':id/revise')
  @Audit({ action: 'REVISE_INVOICE', entityType: 'Invoice' })
  revise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.revise(id, dto.reason, user);
  }

  @Post(':id/notes')
  @Audit({ action: 'ADD_INVOICE_NOTE', entityType: 'Invoice' })
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddCareRequestNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.addNote(id, dto.note, user);
  }

  @Post(':id/payments')
  @Audit({ action: 'RECORD_INVOICE_PAYMENT', entityType: 'Invoice' })
  recordPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordPaymentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.recordPayment(id, dto, user);
  }

  @Delete(':id/payments/:paymentId')
  @Audit({ action: 'DELETE_INVOICE_PAYMENT', entityType: 'Invoice' })
  deletePayment(@Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) paymentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoices.deletePayment(id, paymentId, user);
  }
}

/** Staff caregiver payouts. ADMIN and STAFF. */
@ApiTags('payouts')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  findAll(@Query() query: PayoutQueryDto) {
    return this.payouts.findAll(query);
  }

  @Get('summary')
  summary() {
    return this.payouts.summary();
  }

  @Post()
  @Audit({ action: 'CREATE_PAYOUT', entityType: 'PayoutStatement' })
  create(@Body() dto: CreatePayoutDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payouts.create(dto, user);
  }

  @Post('generate')
  @HttpCode(200)
  @Audit({ action: 'GENERATE_PAYOUTS', entityType: 'PayoutStatement' })
  generate(@Body() dto: GeneratePayoutsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payouts.generate(dto, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.findOne(id);
  }

  @Patch(':id')
  @Audit({ action: 'UPDATE_PAYOUT', entityType: 'PayoutStatement' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayoutDto) {
    return this.payouts.update(id, dto);
  }

  @Delete(':id')
  @Audit({ action: 'DELETE_PAYOUT', entityType: 'PayoutStatement' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.remove(id);
  }

  @Put(':id/lines')
  @Audit({ action: 'UPDATE_PAYOUT_LINES', entityType: 'PayoutStatement' })
  replaceLines(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceLinesDto) {
    return this.payouts.replaceLines(id, dto);
  }

  @Post(':id/lines/from-shifts')
  @HttpCode(200)
  @Audit({ action: 'UPDATE_PAYOUT_LINES', entityType: 'PayoutStatement' })
  addShiftLines(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.addShiftLines(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Audit({ action: 'APPROVE_PAYOUT', entityType: 'PayoutStatement' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payouts.approve(id, user);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Audit({ action: 'REOPEN_PAYOUT', entityType: 'PayoutStatement' })
  reopen(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.reopen(id);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Audit({ action: 'PAY_PAYOUT', entityType: 'PayoutStatement' })
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayPayoutDto, @CurrentUser() user: AuthenticatedUser) {
    return this.payouts.pay(id, dto, user);
  }

  @Post(':id/void')
  @HttpCode(200)
  @Audit({ action: 'VOID_PAYOUT', entityType: 'PayoutStatement' })
  void(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.payouts.void(id, dto.reason);
  }
}

/** The client's invoices and the caregiver's statements: issued / approved ones only. */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('me')
export class MyBillingController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payouts: PayoutsService,
    private readonly payhere: PayhereService,
  ) {}

  @Get('invoices')
  @Roles('PATIENT_GUARDIAN')
  myInvoices(@CurrentUser() user: AuthenticatedUser) {
    return this.invoices.listForClient(user);
  }

  @Get('invoices/:id')
  @Roles('PATIENT_GUARDIAN')
  myInvoice(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.findForClient(user, id);
  }

  @Post('invoices/:id/payhere')
  @HttpCode(200)
  @Roles('PATIENT_GUARDIAN')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'START_ONLINE_PAYMENT', entityType: 'Invoice' })
  payOnline(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayhereCheckoutDto) {
    return this.payhere.checkout(user, id, dto.email);
  }

  @Get('payouts')
  @Roles('CAREGIVER')
  myPayouts(@CurrentUser() user: AuthenticatedUser) {
    return this.payouts.listForCaregiver(user);
  }
}

/**
 * Where PayHere posts payment outcomes (form-encoded, no sign-in). Every
 * notification is verified against the merchant secret before anything is
 * believed; see PayhereService.
 */
@Controller('payments/payhere')
export class PayhereNotifyController {
  constructor(private readonly payhere: PayhereService) {}

  @Post('notify')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async notify(@Body() body: PayhereNotification) {
    const result = await this.payhere.handleNotification(body ?? {});
    if (result === 'BAD_SIGNATURE') throw new BadRequestException('Invalid signature');
    return 'OK';
  }
}
