import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { CareRequestsService } from './care-requests.service';
import { CareRequestQueryDto } from './dto/care-request-query.dto';
import { AddCareRequestNoteDto, AssignCareRequestDto, UpdateCareRequestStatusDto } from './dto/update-care-request-status.dto';

/**
 * The staff Requests queue. ADMIN and STAFF, like the Clients list it sits
 * next to - VERIFIER works on caregiver credentials and has no business with
 * clients' contact details.
 */
@ApiTags('care-requests')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('care-requests')
export class CareRequestsController {
  constructor(private readonly requests: CareRequestsService) {}

  @Get()
  findAll(@Query() query: CareRequestQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.findAll(query, user);
  }

  @Get('summary')
  summary() {
    return this.requests.summary();
  }

  @Get('assignable-staff')
  assignableStaff() {
    return this.requests.assignableStaff();
  }

  @Get(':id')
  @Audit({ action: 'VIEW_CARE_REQUEST', entityType: 'CareRequest' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.findOne(id);
  }

  @Patch(':id/status')
  @Audit({ action: 'UPDATE_CARE_REQUEST_STATUS', entityType: 'CareRequest' })
  updateStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCareRequestStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.updateStatus(id, dto, user);
  }

  @Post(':id/notes')
  @Audit({ action: 'ADD_CARE_REQUEST_NOTE', entityType: 'CareRequest' })
  addNote(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddCareRequestNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.addNote(id, dto.note, user);
  }

  @Patch(':id/assign')
  @Audit({ action: 'ASSIGN_CARE_REQUEST', entityType: 'CareRequest' })
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignCareRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.assign(id, dto.userId ?? null, user);
  }
}
