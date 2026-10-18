import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { AddCareRequestNoteDto } from '../care-requests/dto/update-care-request-status.dto';
import { BookingsService } from './bookings.service';
import { AddShiftDto, BookingQueryDto, CancelBookingDto, CreateBookingDto, ExtendBookingDto, UpdateBookingDto, UpdateShiftDto } from './dto/booking.dto';

/** Staff booking management. ADMIN and STAFF, like Requests and Clients. */
@ApiTags('bookings')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  findAll(@Query() query: BookingQueryDto) {
    return this.bookings.findAll(query);
  }

  @Get('summary')
  summary() {
    return this.bookings.summary();
  }

  @Post()
  @Audit({ action: 'CREATE_BOOKING', entityType: 'Booking' })
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.create(dto, user);
  }

  @Get(':id')
  @Audit({ action: 'VIEW_BOOKING', entityType: 'Booking' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.findOne(id);
  }

  @Patch(':id')
  @Audit({ action: 'UPDATE_BOOKING', entityType: 'Booking' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.update(id, dto, user);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Audit({ action: 'CONFIRM_BOOKING', entityType: 'Booking' })
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.confirm(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Audit({ action: 'CANCEL_BOOKING', entityType: 'Booking' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.cancel(id, dto.reason, user);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Audit({ action: 'COMPLETE_BOOKING', entityType: 'Booking' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.complete(id, user);
  }

  @Post(':id/extend')
  @HttpCode(200)
  @Audit({ action: 'EXTEND_BOOKING', entityType: 'Booking' })
  extend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ExtendBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.extend(id, dto.endDate, user);
  }

  @Post(':id/notes')
  @Audit({ action: 'ADD_BOOKING_NOTE', entityType: 'Booking' })
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddCareRequestNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.addNote(id, dto.note, user);
  }

  @Post(':id/shifts')
  @Audit({ action: 'ADD_SHIFT', entityType: 'Booking' })
  addShift(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.addShift(id, dto, user);
  }

  @Patch(':id/shifts/:shiftId')
  @Audit({ action: 'UPDATE_SHIFT', entityType: 'Booking' })
  updateShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.updateShift(id, shiftId, dto, user);
  }

  @Delete(':id/shifts/:shiftId')
  @Audit({ action: 'REMOVE_SHIFT', entityType: 'Booking' })
  removeShift(@Param('id', ParseUUIDPipe) id: string, @Param('shiftId', ParseUUIDPipe) shiftId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.removeShift(id, shiftId, user);
  }
}

/** The client's and the caregiver's own view: confirmed bookings and shifts only. */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('me')
export class MyBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('bookings')
  @Roles('PATIENT_GUARDIAN')
  clientBookings(@CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.bookings.listForClient(user, req.lang);
  }

  @Get('shifts')
  @Roles('CAREGIVER')
  caregiverShifts(@CurrentUser() user: AuthenticatedUser) {
    return this.bookings.listForCaregiver(user);
  }
}
