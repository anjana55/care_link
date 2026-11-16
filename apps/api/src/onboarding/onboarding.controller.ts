import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OnboardingAgentService } from './onboarding-agent.service';
import { ReferenceAnswerDto, ReferenceTokenDto } from './dto/reference-answer.dto';

/**
 * A referee's three questions, opened from the link they were sent. The token
 * travels in the body, not the URL path, so it stays out of request logs.
 */
@ApiTags('references')
@Controller('public/references')
export class PublicReferencesController {
  constructor(private readonly agent: OnboardingAgentService) {}

  @Public()
  @Post('check')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  check(@Body() dto: ReferenceTokenDto) {
    return this.agent.checkReference(dto.token);
  }

  @Public()
  @Post('answer')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  answer(@Body() dto: ReferenceAnswerDto) {
    const { token, ...answer } = dto;
    return this.agent.answerReference(token, answer);
  }
}

/** The verification file on the staff caregiver page. */
@ApiTags('caregivers')
@ApiBearerAuth()
@Controller('caregivers/:caregiverId/onboarding-file')
export class OnboardingFileController {
  constructor(private readonly agent: OnboardingAgentService) {}

  @Get()
  @Roles('ADMIN', 'STAFF', 'VERIFIER')
  async get(@Param('caregiverId', ParseUUIDPipe) caregiverId: string) {
    return { file: await this.agent.fileFor(caregiverId) };
  }
}
