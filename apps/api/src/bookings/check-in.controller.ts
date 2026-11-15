import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CheckInService } from './check-in.service';
import { CheckInDto, PositionDto, StaffCheckInDto, UpdateCheckInSettingsDto } from './dto/check-in.dto';

/** A caregiver checks in to their own shift with the client's arrival code, and out when they leave. */
@ApiTags('check-in')
@ApiBearerAuth()
@Roles('CAREGIVER')
@Controller('me/shifts')
export class MyCheckInController {
  constructor(private readonly checkIns: CheckInService) {}

  @Post(':id/check-in')
  @HttpCode(200)
  async checkIn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckInDto, @CurrentUser() user: AuthenticatedUser) {
    await this.checkIns.checkIn(user, id, dto);
    return { ok: true };
  }

  @Post(':id/check-out')
  @HttpCode(200)
  async checkOut(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PositionDto, @CurrentUser() user: AuthenticatedUser) {
    await this.checkIns.checkOut(user, id, dto);
    return { ok: true };
  }
}

/** Staff: today's visits and where each stands, and recording a check-in or check-out on a caregiver's behalf. */
@ApiTags('check-in')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('visits')
export class VisitsController {
  constructor(private readonly checkIns: CheckInService) {}

  @Get('today')
  today() {
    return this.checkIns.today();
  }

  @Post(':shiftId/check-in')
  @HttpCode(200)
  @Audit({ action: 'RECORD_CHECK_IN', entityType: 'BookingShift' })
  checkIn(@Param('shiftId', ParseUUIDPipe) shiftId: string, @Body() dto: StaffCheckInDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checkIns.staffCheckIn(shiftId, dto, user);
  }

  @Post(':shiftId/check-out')
  @HttpCode(200)
  @Audit({ action: 'RECORD_CHECK_OUT', entityType: 'BookingShift' })
  checkOut(@Param('shiftId', ParseUUIDPipe) shiftId: string, @Body() dto: StaffCheckInDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checkIns.staffCheckOut(shiftId, dto, user);
  }
}

/** Admin-only: Settings > Check-in. */
@ApiTags('settings')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('settings/check-in')
export class CheckInSettingsController {
  constructor(private readonly checkIns: CheckInService) {}

  @Get()
  get() {
    return this.checkIns.settingsForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_CHECK_IN_SETTINGS', entityType: 'CheckInSettings' })
  update(@Body() dto: UpdateCheckInSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.checkIns.updateSettings(dto, user.userId);
  }
}
