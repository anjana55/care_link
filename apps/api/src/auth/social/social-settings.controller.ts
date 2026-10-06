import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SocialAuthSettingsService, parseSocialProvider } from './social-settings.service';
import { SocialProviderRegistry } from './social-provider';
import { UpdateSocialProviderSettingsDto } from '../dto/update-social-provider-settings.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Admin-only management of Google / Microsoft / Facebook sign-in: whether each
 * provider is offered, and the OAuth client it uses. Sits beside
 * /settings/whatsapp under the same admin Settings area.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/social-auth')
@Roles('ADMIN')
export class SocialAuthSettingsController {
  constructor(
    private readonly settings: SocialAuthSettingsService,
    private readonly registry: SocialProviderRegistry,
  ) {}

  @Get()
  list() {
    return this.settings.getForAdmin();
  }

  @Patch(':provider')
  @Audit({ action: 'UPDATE_SOCIAL_AUTH_SETTINGS', entityType: 'SocialAuthSettings' })
  update(
    @Param('provider') provider: string,
    @Body() dto: UpdateSocialProviderSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.update(parseSocialProvider(provider), dto, user.userId);
  }

  /**
   * Checks the *saved* client ID and secret against the provider's token
   * endpoint, so an admin finds a typo here and not when the first caregiver
   * fails to sign in. It cannot prove the redirect URI is registered - only a
   * real sign-in does that - and says so.
   */
  @Post(':provider/test')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Audit({ action: 'TEST_SOCIAL_AUTH_SETTINGS', entityType: 'SocialAuthSettings' })
  async test(@Param('provider') raw: string) {
    const provider = parseSocialProvider(raw);
    const cfg = await this.settings.getResolved(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      return { id: provider, ok: false, message: 'Save a client ID and client secret first.' };
    }
    const check = await SocialProviderRegistry.build(cfg).probeCredentials(this.settings.redirectUri(provider));
    return { id: provider, ...check };
  }
}
