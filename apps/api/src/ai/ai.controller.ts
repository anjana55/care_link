import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AiTestResult } from '@care-platform/shared';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiSettingsService } from './ai-settings.service';
import { AiProviderService, AiUnavailableError } from './ai-provider.service';
import { AiMatchingService } from './ai-matching.service';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';
import { AiExtractDto, AiSearchDto } from './dto/ai-search.dto';

/** Settings > AI. ADMIN only, like every other settings section. */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/ai')
@Roles('ADMIN')
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly provider: AiProviderService,
  ) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_AI_SETTINGS', entityType: 'AiSettings' })
  update(@Body() dto: UpdateAiSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }

  /**
   * Tries the *saved* configuration - even while AI is switched off, so an
   * admin can verify it before turning it on: one plain reply, then one tool
   * call, because the assistant cannot work with a model that will not call tools.
   */
  @Post('test')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async test(): Promise<AiTestResult & { id: string }> {
    const s = await this.settings.getResolved();
    const started = Date.now();
    try {
      const reply = await this.provider.chat(s, {
        maxTokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      });
      let toolCalling = false;
      try {
        const tool = await this.provider.chat(s, {
          maxTokens: 128,
          messages: [{ role: 'user', content: 'What is the status of request CR-TEST01? Use the tool.' }],
          tools: [
            {
              name: 'get_request',
              description: 'Look up a care request by its reference',
              parameters: { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'] },
            },
          ],
        });
        toolCalling = tool.toolCalls.some((c) => c.name === 'get_request');
      } catch {
        toolCalling = false;
      }
      return {
        id: 'default',
        ok: true,
        provider: s.provider,
        model: s.model,
        latencyMs: Date.now() - started,
        toolCalling,
        message: `Model replied: "${reply.content.trim().slice(0, 80)}"${toolCalling ? '' : ' - but it did not call a tool, so the staff assistant will not work with this model.'}`,
      };
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      return {
        id: 'default',
        ok: false,
        provider: s.provider,
        model: s.model,
        latencyMs: Date.now() - started,
        toolCalling: false,
        message: err.detail ? `${err.message}: ${err.detail}` : err.message,
      };
    }
  }
}

/** Which AI features are on - for the staff app to decide what to show. No configuration details. */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@Roles('ADMIN', 'STAFF')
export class AiStatusController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get('status')
  status() {
    return this.settings.featureStatus();
  }
}

/** Staff caregiver suggestions for a request. Same roles as the Requests queue. */
@ApiTags('care-requests')
@ApiBearerAuth()
@Controller('care-requests')
@Roles('ADMIN', 'STAFF')
export class CareRequestSuggestionsController {
  constructor(private readonly matching: AiMatchingService) {}

  @Get(':id/suggestions')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  suggestions(@Param('id', ParseUUIDPipe) id: string) {
    return this.matching.suggestForRequest(id);
  }
}

/**
 * Public AI Search. Model calls cost money or local compute, so these get the
 * tightest throttles in the API. Extraction answers 503 when AI is off (the
 * site only offers AI Search when /public/meta/search-config says it is on);
 * search never fails for model trouble - it falls back to the Normal Search
 * order and says so with `aiRanked: false`.
 */
@ApiTags('public-search')
@Controller('public/ai')
export class PublicAiSearchController {
  constructor(private readonly matching: AiMatchingService) {}

  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post('extract')
  @HttpCode(200)
  extract(@Body() dto: AiExtractDto) {
    return this.matching.publicExtract(dto.query, dto.locale);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('search')
  @HttpCode(200)
  search(@Body() dto: AiSearchDto) {
    return this.matching.publicSearch(dto.request, dto.query);
  }
}
