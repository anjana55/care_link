import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CorrectionsService } from './corrections.service';
import { IssueReportsService } from './issue-reports.service';
import { AmendBookingDto, CloseIssueReportDto, CreateIssueReportDto } from './dto/amend-booking.dto';

/**
 * Corrections to a confirmed or completed booking - work that already
 * happened, or is already billed. Staff only, like the rest of bookings.
 */
@ApiTags('bookings')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('bookings/:id/amendments')
export class CorrectionsController {
  constructor(
    private readonly corrections: CorrectionsService,
    private readonly issues: IssueReportsService,
  ) {}

  /** The booking's corrections, the adjustments they left, and what clients and caregivers have reported on it. */
  @Get()
  async history(@Param('id', ParseUUIDPipe) id: string) {
    const [history, reports] = await Promise.all([this.corrections.history(id), this.issues.listForBooking(id)]);
    return { ...history, reports };
  }

  /** What the correction would do - to the roster and to every invoice and pay statement - without doing it. */
  @Post('preview')
  @HttpCode(200)
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AmendBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.corrections.preview(id, dto, user);
  }

  @Post()
  @HttpCode(200)
  @Audit({ action: 'AMEND_BOOKING', entityType: 'Booking' })
  apply(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AmendBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.corrections.apply(id, dto, user);
  }
}

/** Staff answering a report without (or besides) a correction. */
@ApiTags('bookings')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('booking-issues')
export class IssueReportsController {
  constructor(private readonly issues: IssueReportsService) {}

  @Post(':id/close')
  @HttpCode(200)
  @Audit({ action: 'CLOSE_ISSUE_REPORT', entityType: 'BookingIssueReport' })
  close(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseIssueReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.issues.close(id, dto, user);
  }
}

/**
 * Clients and caregivers reporting a problem on their own booking or shift,
 * and following what happened to their reports.
 */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('me')
export class MyIssueReportsController {
  constructor(private readonly issues: IssueReportsService) {}

  @Post('bookings/:id/issues')
  @Roles('PATIENT_GUARDIAN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit({ action: 'REPORT_BOOKING_ISSUE', entityType: 'Booking' })
  reportOnBooking(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateIssueReportDto, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.issues.createForClient(user, id, dto, req.lang ?? 'en');
  }

  @Post('shifts/:id/issues')
  @Roles('CAREGIVER')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit({ action: 'REPORT_SHIFT_ISSUE', entityType: 'BookingShift' })
  reportOnShift(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateIssueReportDto, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.issues.createForCaregiver(user, id, dto, req.lang ?? 'en');
  }

  @Get('issues')
  @Roles('PATIENT_GUARDIAN', 'CAREGIVER')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.issues.listMine(user);
  }
}
