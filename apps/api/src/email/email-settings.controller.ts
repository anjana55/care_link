import { Body, Controller, Get, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { EmailSettingsService } from './email-settings.service';
import { EmailService } from './email.service';
import { SendTestEmailDto, UpdateEmailSettingsDto } from './dto/update-email-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

/**
 * Admin-only management of the outgoing mail server (SMTP). Sits beside
 * /settings/whatsapp and /settings/social-auth under the same admin Settings
 * area, and replaces editing SMTP_* in .env.production and restarting.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/email')
@Roles('ADMIN')
export class EmailSettingsController {
  constructor(
    private readonly settings: EmailSettingsService,
    private readonly email: EmailService,
  ) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_EMAIL_SETTINGS', entityType: 'EmailSettings' })
  update(@Body() dto: UpdateEmailSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }

  /**
   * Sends a real email with the *saved* settings, so an admin finds a wrong
   * port or password here rather than when the first caregiver never gets
   * their verification email.
   */
  @Post('test')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit({ action: 'TEST_EMAIL_SETTINGS', entityType: 'EmailSettings' })
  async test(@Body() dto: SendTestEmailDto) {
    try {
      const result = await this.email.sendTestEmail(dto.to);
      return {
        id: 'default',
        success: result.accepted,
        message: result.accepted
          ? `The server accepted the test email for ${dto.to}. If it doesn't arrive within a few minutes, check the spam folder and the sender address's SPF/DKIM records.`
          : `The server did not accept the test email for ${dto.to}${result.response ? ` (${result.response})` : ''}.`,
      };
    } catch (err) {
      // The button exists to tell an admin *why* delivery failed, so the SMTP
      // server's own reason travels back. ADMIN-only route; holds no secret.
      throw new ServiceUnavailableException(`Couldn't send the test email: ${(err as Error).message}`);
    }
  }
}
