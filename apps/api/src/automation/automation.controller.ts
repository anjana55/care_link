import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AUTOMATION_CASE_TYPES, AUTOMATION_FUNCTIONS, type AutomationCaseType, type AutomationFunction } from '@care-platform/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from './automation.service';
import {
  DecisionsQueryDto,
  ResetTripDto,
  ReviewDecisionDto,
  SetActionPolicyDto,
  SetMasterDto,
  SetModeDto,
  TakeOverDto,
  UpdateAutomationSettingsDto,
} from './dto/automation.dto';

const asEnum = <T extends readonly string[]>(values: T) => new ParseEnumPipe(Object.fromEntries(values.map((v) => [v, v])));
const functionPipe = asEnum(AUTOMATION_FUNCTIONS);
const caseTypePipe = asEnum(AUTOMATION_CASE_TYPES);

/**
 * Settings > Automation. ADMIN only, like every other settings section: the
 * master switch, each function's dial, trip resets, and which commitments
 * may run without approval.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/automation')
@Roles('ADMIN')
export class AutomationSettingsController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  overview() {
    return this.automation.overview();
  }

  @Patch()
  @Audit({ action: 'UPDATE_AUTOMATION_SETTINGS', entityType: 'AutomationSettings' })
  update(@Body() dto: UpdateAutomationSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.updateBar(dto, user.userId);
  }

  @Post('master')
  @HttpCode(200)
  @Audit({ action: 'SET_AUTOMATION_MASTER_SWITCH', entityType: 'AutomationSettings' })
  master(@Body() dto: SetMasterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.setMaster(dto.on, dto.reason ?? null, user.userId);
  }

  @Patch('functions/:key')
  @Audit({ action: 'SET_AUTOMATION_MODE', entityType: 'AutomationFunction' })
  setMode(@Param('key', functionPipe) key: AutomationFunction, @Body() dto: SetModeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.setMode(key, dto.mode, user.userId);
  }

  @Post('functions/:key/reset')
  @HttpCode(200)
  @Audit({ action: 'RESET_AUTOMATION_TRIP', entityType: 'AutomationFunction' })
  reset(@Param('key', functionPipe) key: AutomationFunction, @Body() dto: ResetTripDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.resetTrip(key, user.userId, dto.mode);
  }

  @Patch('actions/:action')
  @Audit({ action: 'SET_AUTOMATION_ACTION_POLICY', entityType: 'AutomationAction' })
  setActionPolicy(@Param('action') action: string, @Body() dto: SetActionPolicyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.setActionPolicy(action, dto, user.userId);
  }
}

/**
 * What staff use day to day: who is driving a case, "Take over" and "Hand
 * back", the agents' decision log, and their verdict on a decision.
 */
@ApiTags('automation')
@ApiBearerAuth()
@Controller('automation')
@Roles('ADMIN', 'STAFF')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('cases/:caseType/:caseId')
  caseControl(@Param('caseType', caseTypePipe) caseType: AutomationCaseType, @Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.automation.caseAutomation({ caseType, caseId });
  }

  @Post('cases/:caseType/:caseId/take-over')
  @HttpCode(200)
  @Audit({ action: 'TAKE_OVER_CASE', entityType: 'AutomationCase' })
  async takeOver(
    @Param('caseType', caseTypePipe) caseType: AutomationCaseType,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: TakeOverDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.automation.takeOver({ caseType, caseId }, { userId: user.userId, source: 'STAFF', reason: dto.reason });
    return this.automation.caseAutomation({ caseType, caseId });
  }

  @Post('cases/:caseType/:caseId/hand-back')
  @HttpCode(200)
  @Audit({ action: 'HAND_BACK_CASE', entityType: 'AutomationCase' })
  async handBack(@Param('caseType', caseTypePipe) caseType: AutomationCaseType, @Param('caseId', ParseUUIDPipe) caseId: string) {
    await this.automation.handBack({ caseType, caseId });
    return this.automation.caseAutomation({ caseType, caseId });
  }

  @Get('decisions')
  decisions(@Query() query: DecisionsQueryDto) {
    return this.automation.decisions({ ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 25 });
  }

  @Post('decisions/:id/review')
  @HttpCode(200)
  @Audit({ action: 'REVIEW_AGENT_DECISION', entityType: 'AgentDecision' })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.review(id, dto.verdict, dto.note ?? null, user.userId);
  }
}
