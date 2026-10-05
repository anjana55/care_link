import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SocialAuthService, SocialLinkError } from './social-auth.service';
import { RegisterCaregiverUnifiedDto } from './dto/register-caregiver-unified.dto';
import { ExchangeSocialCodeDto } from './dto/exchange-social-code.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';

/**
 * The unified caregiver registration and its Google/Microsoft/Facebook
 * sign-on, sitting alongside (never instead of) the email/password and WhatsApp
 * OTP endpoints in AuthController and WhatsappAuthController.
 */
@ApiTags('auth')
@Controller('auth')
export class SocialAuthController {
  private readonly logger = new Logger(SocialAuthController.name);

  constructor(
    private readonly socialAuth: SocialAuthService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The one registration form: phone number, optional email, and the personal
   * information every caregiver flow asks for.
   *
   * The response carries a pending token rather than a session: the caregiver
   * has an account at this point but has not yet proved who they are, and the
   * token authorises exactly that one next step.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-caregiver/unified')
  async registerCaregiver(@Body() dto: RegisterCaregiverUnifiedDto, @Req() req: Request) {
    const result = await this.socialAuth.registerCaregiver(dto);
    await this.audit.record({
      action: 'REGISTER_CAREGIVER_SOCIAL',
      entityType: 'Caregiver',
      entityId: result.caregiverId,
      ipAddress: req.ip,
    });
    return result;
  }

  /** Which provider buttons the frontend should render. Secret-free. */
  @Public()
  @Get('social/providers')
  providers() {
    return this.socialAuth.getProviders();
  }

  /**
   * Returns the provider's consent URL as JSON rather than redirecting.
   *
   * The frontend fetches this with XHR and then navigates: a fetch that followed
   * a 302 would try to read Google's login page as if it were our JSON, which
   * fails on CORS with an opaque error and no useful message.
   */
  @Public()
  @Get('social/:provider/authorize-url')
  authorizeUrl(@Param('provider') provider: string, @Query('token') token: string) {
    return { url: this.socialAuth.authorizeUrl(provider, token) };
  }

  /**
   * The registered redirect URI for each provider. Always answers with a
   * redirect, never a JSON body - a browser arrives here by navigation, and an
   * exception escaping as a 500 would render a JSON blob over a page the
   * caregiver is looking at. Every failure is turned into a redirect carrying
   * a short code, so no internal reason ever reaches the URL bar or the logs.
   */
  @Public()
  @Get('social/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const frontend = this.frontendUrl();

    if (providerError || !code || !state) {
      return this.fail(res, frontend, providerError ? 'declined' : 'invalid_request');
    }
    try {
      const handoffCode = await this.socialAuth.completeLink({ provider, code, pendingToken: state });
      await this.audit.record({
        action: 'LINK_SOCIAL_ACCOUNT',
        entityType: 'User',
        ipAddress: req.ip,
      });
      return res.redirect(`${frontend}/caregiver/social/callback?code=${encodeURIComponent(handoffCode)}`);
    } catch (err) {
      // Only a short code travels in the URL. The provider's own error
      // payload can contain the client secret, and a message is far too much
      // text for a query string - the callback page renders the code in the
      // reader's language. The full reason is logged here, where it is safe.
      const reason =
        err instanceof SocialLinkError ? err.code : err instanceof HttpException ? 'provider_error' : 'unknown';
      this.logger.error(`Social link failed for ${provider}`, err instanceof Error ? err.stack : undefined);
      return this.fail(res, frontend, reason, provider);
    }
  }

  /**
   * Trades the one-time code for the session. This is where the caregiver's
   * tokens are actually minted - over POST, so they never pass through a URL,
   * a Referer header or an access log.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('social/exchange')
  async exchange(@Body() dto: ExchangeSocialCodeDto, @Req() req: Request) {
    const tokens = await this.socialAuth.exchangeHandoffCode(dto.code);
    await this.audit.record({ action: 'LOGIN_SOCIAL', entityType: 'User', ipAddress: req.ip });
    return tokens;
  }

  private fail(res: Response, frontend: string, reason: string, provider?: string) {
    const params = new URLSearchParams({ error: reason });
    if (provider) params.set('provider', provider);
    return res.redirect(`${frontend}/caregiver/social/callback?${params.toString()}`);
  }

  private frontendUrl() {
    return (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/$/, '');
  }
}