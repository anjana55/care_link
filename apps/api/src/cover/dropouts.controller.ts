import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ShiftDropoutsService } from './shift-dropouts.service';
import { CantMakeShiftDto, SetStandbyDto } from './dto/dropouts.dto';

/** A caregiver tells the office they cannot make one of their shifts - or that they can after all. */
@ApiTags('check-in')
@ApiBearerAuth()
@Roles('CAREGIVER')
@Controller('me/shifts/:id/cant-make')
export class MyCantMakeController {
  constructor(private readonly dropouts: ShiftDropoutsService) {}

  @Post()
  @HttpCode(200)
  cantMake(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CantMakeShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dropouts.cantMake(user, id, dto.note);
  }

  @Delete()
  canAfterAll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dropouts.canMakeAfterAll(id, { user, staff: false });
  }
}

/** Staff: the caregiver phoned to say they can come after all. */
@ApiTags('visits')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('visits/:shiftId/cant-make')
export class StaffCantMakeController {
  constructor(private readonly dropouts: ShiftDropoutsService) {}

  @Delete()
  @Audit({ action: 'CLEAR_CANT_MAKE', entityType: 'BookingShift' })
  canAfterAll(@Param('shiftId', ParseUUIDPipe) shiftId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dropouts.canMakeAfterAll(shiftId, { user, staff: true });
  }
}

/** Staff: the booking's standby caregiver, asked first when one of its shifts needs cover. */
@ApiTags('bookings')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('bookings/:id/standby')
export class StandbyController {
  constructor(private readonly dropouts: ShiftDropoutsService) {}

  @Get()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.dropouts.standby(id);
  }

  @Put()
  @Audit({ action: 'SET_STANDBY', entityType: 'Booking' })
  set(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStandbyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dropouts.setStandby(id, dto.caregiverId, { userId: user.userId, agent: false });
  }
}
