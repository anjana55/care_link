import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUrl, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  AUTOMATION_CASE_TYPES,
  AUTOMATION_FUNCTIONS,
  AUTOMATION_MODES,
  DATA_CLASSES,
  STAFF_VERDICTS,
  aiProviderValues,
  type AiProvider,
  type AutomationEndpointInput,
  type AutomationCaseType,
  type AutomationFunction,
  type AutomationMode,
  type DataClass,
  type StaffVerdict,
} from '@care-platform/shared';

const trimToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** PATCH /settings/automation/functions/:key */
export class SetModeDto {
  @ApiProperty({ enum: AUTOMATION_MODES })
  @IsIn(AUTOMATION_MODES)
  mode: AutomationMode;
}

/** POST /settings/automation/functions/:key/reset */
export class ResetTripDto {
  @ApiPropertyOptional({ enum: AUTOMATION_MODES, description: 'Where to put the dial. Left out: back where it was.' })
  @IsOptional()
  @IsIn(AUTOMATION_MODES)
  mode?: AutomationMode;
}

/** POST /settings/automation/master */
export class SetMasterDto {
  @ApiProperty({ description: 'true = everything manual, now' })
  @IsBoolean()
  on: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

/** PATCH /settings/automation - the promotion bar. */
export class UpdateAutomationSettingsDto {
  @ApiPropertyOptional({ minimum: 10, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(1000)
  cases?: number;

  @ApiPropertyOptional({ minimum: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(100)
  agreementPercent?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  demoteAfterReversals?: number;
}

/** PATCH /settings/automation/actions/:action */
export class SetActionPolicyDto {
  @ApiPropertyOptional({ description: 'Tier 2 only: let the action act alone in Auto. Needs the promotion bar to be met.' })
  @IsOptional()
  @IsBoolean()
  autoAllowed?: boolean;

  @ApiPropertyOptional({ description: 'Numeric limits for this action, e.g. { "maxAmount": 25000 }. null clears them.' })
  @IsOptional()
  @IsObject()
  limits?: Record<string, number> | null;

  @ApiPropertyOptional({ description: "Start the action's record against staff again from now." })
  @IsOptional()
  @IsBoolean()
  resetRecord?: boolean;
}

/** POST /automation/cases/:caseType/:caseId/take-over */
export class TakeOverDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

/** GET /automation/decisions */
export class DecisionsQueryDto {
  @ApiPropertyOptional({ enum: AUTOMATION_FUNCTIONS })
  @IsOptional()
  @IsIn(AUTOMATION_FUNCTIONS)
  function?: AutomationFunction;

  @ApiPropertyOptional({ enum: AUTOMATION_CASE_TYPES })
  @IsOptional()
  @IsIn(AUTOMATION_CASE_TYPES)
  caseType?: AutomationCaseType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  caseId?: string;

  @ApiPropertyOptional({ description: 'Only proposals still waiting for a staff verdict' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  awaitingStaff?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** POST /automation/decisions/:id/review */
export class ReviewDecisionDto {
  @ApiProperty({ enum: STAFF_VERDICTS })
  @IsIn(STAFF_VERDICTS)
  verdict: StaffVerdict;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** PATCH /settings/automation/functions/:key/endpoints - null clears a choice. */
export class SetFunctionEndpointsDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  endpointId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  fallbackEndpointId?: string | null;
}

/** PATCH /settings/automation/endpoints/:id. Same guard rails as Settings > AI. */
export class UpdateEndpointDto implements AutomationEndpointInput {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: aiProviderValues })
  @IsOptional()
  @IsIn(aiProviderValues, { message: 'Choose a provider' })
  provider?: AiProvider;

  @ApiPropertyOptional({ example: 'http://localhost:11434' })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }, { message: 'Enter the address as a full http(s) URL' })
  @MaxLength(255)
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored key.' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  clearApiKey?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  temperature?: number | null;

  @ApiPropertyOptional({ minimum: 256, maximum: 8192 })
  @IsOptional()
  @IsInt()
  @Min(256)
  @Max(8192)
  maxTokens?: number;

  @ApiPropertyOptional({ minimum: 3000, maximum: 120000 })
  @IsOptional()
  @IsInt()
  @Min(3000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({ enum: DATA_CLASSES, description: 'The most sensitive class of data this model may be sent' })
  @IsOptional()
  @IsIn(DATA_CLASSES)
  clearedFor?: DataClass;
}

/** POST /settings/automation/endpoints */
export class CreateEndpointDto extends UpdateEndpointDto {
  @ApiPropertyOptional({ description: 'Take provider, address, model, key and limits from Settings > AI' })
  @IsOptional()
  @IsBoolean()
  copyDefault?: boolean;
}
