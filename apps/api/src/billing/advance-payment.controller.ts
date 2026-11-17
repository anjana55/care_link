import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdvancePaymentService } from './advance-payment.service';

export class ResumeVisitsDto {
  @ApiPropertyOptional({ description: 'Why visits resume without payment - kept in the booking history' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings/:id')
@Roles('ADMIN', 'STAFF')
export class BookingPaymentHoldController {
  constructor(private readonly advance: AdvancePaymentService) {}

  @Post('resume-visits')
  @HttpCode(200)
  @Audit({ action: 'RESUME_VISITS_WITHOUT_PAYMENT', entityType: 'Booking' })
  resume(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResumeVisitsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.advance.resume(id, dto.reason, user);
  }
}

/** Payment before confirmation: staff send the first invoice of a draft billed in advance. */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings/:id/advance-invoice')
@Roles('ADMIN', 'STAFF')
export class AdvancePaymentController {
  constructor(private readonly advance: AdvancePaymentService) {}

  @Post()
  @Audit({ action: 'SEND_ADVANCE_INVOICE', entityType: 'Invoice' })
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.advance.send(id, user);
  }
}
