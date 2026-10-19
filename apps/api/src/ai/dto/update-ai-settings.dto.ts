import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { aiProviderValues, type AiProvider, type UpdateAiSettingsInput } from '@care-platform/shared';

/**
 * Partial update from Settings > AI. Bounds are guard rails: a pool of hundreds
 * of candidates or a two-minute timeout would make a public search page
 * unusable and expensive, whatever the model.
 */
export class UpdateAiSettingsDto implements UpdateAiSettingsInput {
  @ApiPropertyOptional({ description: 'Master switch for every AI feature' })
  @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({ enum: aiProviderValues })
  @IsOptional() @IsIn(aiProviderValues, { message: 'Choose a provider' }) provider?: AiProvider;

  @ApiPropertyOptional({ example: 'http://localhost:11434' })
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }, { message: 'Enter the endpoint as a full http(s) URL' })
  @MaxLength(255)
  baseUrl?: string;

  @ApiPropertyOptional({ example: 'qwen2.5:7b-instruct' })
  @IsOptional() @IsString() @MaxLength(120) model?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored key.' })
  @IsOptional() @IsString() @MaxLength(1024) apiKey?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() clearApiKey?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, nullable: true, description: 'null = use the model\'s own default (not sent)' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1) temperature?: number | null;

  @ApiPropertyOptional({ minimum: 256, maximum: 8192 })
  @IsOptional() @IsInt() @Min(256) @Max(8192) maxTokens?: number;

  @ApiPropertyOptional({ minimum: 3000, maximum: 120000 })
  @IsOptional() @IsInt() @Min(3000) @Max(120000) timeoutMs?: number;

  @ApiPropertyOptional({ minimum: 5, maximum: 50 })
  @IsOptional() @IsInt() @Min(5) @Max(50) candidatePoolSize?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() publicSearchEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() staffMatchingEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() staffAssistantEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(4000) searchPrompt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(4000) assistantPrompt?: string | null;
}
