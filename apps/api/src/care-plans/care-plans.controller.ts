import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { resolveLocale } from '@care-platform/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import type { RequestWithLanguage } from '../common/i18n/language.middleware';
import { CarePlansService } from './care-plans.service';
import { CarePlanTemplatesService } from './care-plan-templates.service';
import {
  CareDayQueryDto,
  CareLogQueryDto,
  CarePlanTemplateDto,
  CarePlanTemplateQueryDto,
  CareRecordDto,
  CareRemindersDto,
  CreateCarePlanDto,
  UpdateCarePlanDto,
} from './dto/care-plan.dto';

class SaveAsTemplateDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Give the template a name' })
  @MaxLength(150)
  name: string;
}

const lang = (req: RequestWithLanguage) => resolveLocale(req.lang);

/** The care plan template library. ADMIN and STAFF build and use it; only admins archive. */
@ApiTags('care-plans')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('care-plan-templates')
export class CarePlanTemplatesController {
  constructor(private readonly templates: CarePlanTemplatesService) {}

  @Get()
  list(@Query() query: CarePlanTemplateQueryDto) {
    return this.templates.list(query.status ?? 'ACTIVE');
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.get(id);
  }

  @Post()
  @Audit({ action: 'CREATE_CARE_PLAN_TEMPLATE', entityType: 'CarePlanTemplate' })
  create(@Body() dto: CarePlanTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.create(dto, user);
  }

  @Put(':id')
  @Audit({ action: 'UPDATE_CARE_PLAN_TEMPLATE', entityType: 'CarePlanTemplate' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CarePlanTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.update(id, dto, user);
  }

  @Post(':id/duplicate')
  @Audit({ action: 'DUPLICATE_CARE_PLAN_TEMPLATE', entityType: 'CarePlanTemplate' })
  duplicate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.duplicate(id, user);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Roles('ADMIN')
  @Audit({ action: 'ARCHIVE_CARE_PLAN_TEMPLATE', entityType: 'CarePlanTemplate' })
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setStatus(id, 'ARCHIVED', user);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Roles('ADMIN')
  @Audit({ action: 'RESTORE_CARE_PLAN_TEMPLATE', entityType: 'CarePlanTemplate' })
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.setStatus(id, 'ACTIVE', user);
  }
}

/** A booking's care plan and its care log - staff side. */
@ApiTags('care-plans')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('bookings')
export class BookingCarePlanController {
  constructor(private readonly plans: CarePlansService) {}

  @Get(':id/care-plan')
  @Audit({ action: 'VIEW_CARE_PLAN', entityType: 'Booking' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.getPlan(id);
  }

  @Post(':id/care-plan')
  @Audit({ action: 'CREATE_CARE_PLAN', entityType: 'Booking' })
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateCarePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.createPlan(id, dto, user);
  }

  @Put(':id/care-plan')
  @Audit({ action: 'UPDATE_CARE_PLAN', entityType: 'Booking' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCarePlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.updatePlan(id, dto, user);
  }

  @Post(':id/care-plan/save-as-template')
  @Audit({ action: 'CREATE_CARE_PLAN_TEMPLATE', entityType: 'Booking' })
  saveAsTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAsTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.plans.saveAsTemplate(id, dto.name, user);
  }

  @Get(':id/care-log')
  @Audit({ action: 'VIEW_CARE_LOG', entityType: 'Booking' })
  careLog(@Param('id', ParseUUIDPipe) id: string, @Query() query: CareLogQueryDto, @Req() req: RequestWithLanguage) {
    return this.plans.careLog(id, query, lang(req));
  }

  @Put(':id/care-log/records')
  @Audit({ action: 'CORRECT_CARE_RECORD', entityType: 'Booking' })
  record(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CareRecordDto, @CurrentUser() user: AuthenticatedUser, @Req() req: RequestWithLanguage) {
    return this.plans.staffRecord(id, dto, user, lang(req));
  }
}

/** The client's daily checklist, and the caregiver's read-only plan for a shift. */
@ApiTags('care-plans')
@ApiBearerAuth()
@Controller('me')
export class MyCareController {
  constructor(private readonly plans: CarePlansService) {}

  @Get('care')
  @Roles('PATIENT_GUARDIAN')
  day(@CurrentUser() user: AuthenticatedUser, @Query() query: CareDayQueryDto, @Req() req: RequestWithLanguage) {
    return this.plans.clientDay(user, query.date, lang(req));
  }

  @Put('care/records')
  @Roles('PATIENT_GUARDIAN')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: CareRecordDto, @Req() req: RequestWithLanguage) {
    return this.plans.clientRecord(user, dto, lang(req));
  }

  @Put('care/reminders')
  @Roles('PATIENT_GUARDIAN')
  reminders(@CurrentUser() user: AuthenticatedUser, @Body() dto: CareRemindersDto) {
    return this.plans.setReminders(user, dto.enabled);
  }

  @Get('shifts/:id/care')
  @Roles('CAREGIVER')
  caregiverShift(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithLanguage) {
    return this.plans.caregiverShift(user, id, lang(req));
  }
}
