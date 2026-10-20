import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CorrectionsService } from './corrections.service';
import { AmendBookingDto } from './dto/amend-booking.dto';

/**
 * Corrections to a confirmed or completed booking - work that already
 * happened, or is already billed. Staff only, like the rest of bookings.
 */
@ApiTags('bookings')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('bookings/:id/amendments')
export class CorrectionsController {
  constructor(private readonly corrections: CorrectionsService) {}

  @Get()
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.corrections.history(id);
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
