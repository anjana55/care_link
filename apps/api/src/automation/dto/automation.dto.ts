import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  AUTOMATION_CASE_TYPES,
  AUTOMATION_FUNCTIONS,
  AUTOMATION_MODES,
  STAFF_VERDICTS,
  type AutomationCaseType,
  type AutomationFunction,
  type AutomationMode,
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
