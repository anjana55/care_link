import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CoverService } from './cover.service';
import { SendCoverOffersDto } from './dto/cover.dto';

/** Cover for one shift, for staff: who could take it, who has been asked. Caregivers answer through their job offers. */
@ApiTags('visits')
@ApiBearerAuth()
@Controller('visits/:shiftId/cover')
@Roles('ADMIN', 'STAFF')
export class CoverController {
  constructor(private readonly cover: CoverService) {}

  @Get()
  get(@Param('shiftId', ParseUUIDPipe) shiftId: string) {
    return this.cover.forShift(shiftId);
  }

  @Post('offers')
  @Audit({ action: 'SEND_COVER_OFFER', entityType: 'RequestOffer' })
  send(@Param('shiftId', ParseUUIDPipe) shiftId: string, @Body() dto: SendCoverOffersDto, @CurrentUser() user: AuthenticatedUser) {
    return this.cover.send(shiftId, dto, user);
  }

  @Post('offers/:offerId/withdraw')
  @HttpCode(200)
  @Audit({ action: 'WITHDRAW_COVER_OFFER', entityType: 'RequestOffer' })
  withdraw(@Param('shiftId', ParseUUIDPipe) shiftId: string, @Param('offerId', ParseUUIDPipe) offerId: string) {
    return this.cover.withdraw(shiftId, offerId);
  }
}
