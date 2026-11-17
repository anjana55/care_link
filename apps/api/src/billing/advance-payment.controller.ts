import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdvancePaymentService } from './advance-payment.service';

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
