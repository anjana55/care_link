import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AUTOMATION_CASE_TYPES, AUTOMATION_FUNCTIONS, type AutomationCaseType, type AutomationFunction } from '@care-platform/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from './automation.service';
import { AutomationEndpointsService } from './automation-endpoints.service';
import { JobsService } from '../jobs/jobs.service';
import {
  CreateEndpointDto,
  DecisionsQueryDto,
  ResetTripDto,
  ReviewDecisionDto,
  SetActionPolicyDto,
  SetFunctionEndpointsDto,
  SetMasterDto,
  SetModeDto,
  TakeOverDto,
  UpdateAutomationSettingsDto,
  UpdateEndpointDto,
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
  constructor(
    private readonly automation: AutomationService,
    private readonly endpoints: AutomationEndpointsService,
    private readonly jobs: JobsService,
  ) {}

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

  @Patch('functions/:key/endpoints')
  @Audit({ action: 'SET_AUTOMATION_FUNCTION_MODELS', entityType: 'AutomationFunction' })
  setEndpoints(@Param('key', functionPipe) key: AutomationFunction, @Body() dto: SetFunctionEndpointsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.setFunctionEndpoints(key, dto, user.userId);
  }

  // --- AI models. Each change answers with the whole page again, like the rest. ---

  @Post('endpoints')
  @Audit({ action: 'CREATE_AUTOMATION_ENDPOINT', entityType: 'AutomationEndpoint' })
  async createEndpoint(@Body() dto: CreateEndpointDto, @CurrentUser() user: AuthenticatedUser) {
    await this.endpoints.create(dto, user.userId);
    return this.automation.overview();
  }

  @Patch('endpoints/:id')
  @Audit({ action: 'UPDATE_AUTOMATION_ENDPOINT', entityType: 'AutomationEndpoint' })
  async updateEndpoint(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEndpointDto, @CurrentUser() user: AuthenticatedUser) {
    await this.endpoints.update(id, dto, user.userId);
    return this.automation.overview();
  }

  @Delete('endpoints/:id')
  @Audit({ action: 'DELETE_AUTOMATION_ENDPOINT', entityType: 'AutomationEndpoint' })
  async removeEndpoint(@Param('id', ParseUUIDPipe) id: string) {
    await this.endpoints.remove(id);
    return this.automation.overview();
  }

  @Post('endpoints/:id/test')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  testEndpoint(@Param('id', ParseUUIDPipe) id: string) {
    return this.endpoints.test(id);
  }

  /** Runs an agent once, now, instead of waiting for its next turn. It still obeys its dial. */
  @Post('functions/:key/run')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Audit({ action: 'RUN_AGENT_NOW', entityType: 'AutomationFunction' })
  run(@Param('key', functionPipe) key: AutomationFunction) {
    return this.automation.runNow(key);
  }

  /** Puts a failed background job back in the queue. */
  @Post('jobs/:id/retry')
  @HttpCode(200)
  @Audit({ action: 'RETRY_JOB', entityType: 'Job' })
  async retryJob(@Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.retry(id);
    return this.automation.overview();
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

  @Post('decisions/:id/approve')
  @HttpCode(200)
  @Audit({ action: 'APPROVE_AGENT_PROPOSAL', entityType: 'AgentDecision' })
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.approve(id, user);
  }

  @Post('decisions/:id/decline')
  @HttpCode(200)
  @Audit({ action: 'DECLINE_AGENT_PROPOSAL', entityType: 'AgentDecision' })
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TakeOverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.decline(id, dto.reason ?? null, user.userId);
  }

  @Post('decisions/:id/review')
  @HttpCode(200)
  @Audit({ action: 'REVIEW_AGENT_DECISION', entityType: 'AgentDecision' })
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.automation.review(id, dto.verdict, dto.note ?? null, user.userId);
  }
}
