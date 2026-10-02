import { BadRequestException, Body, Controller, Get, Patch, Post, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WhatsappSettingsService } from './whatsapp-settings.service';
import { WhatsappProviderService, WhatsappDeliveryError } from './whatsapp-provider.service';
import { UpdateWhatsappSettingsDto, SendTestMessageDto } from './dto/update-whatsapp-settings.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Audit } from '../common/decorators/audit.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { normalizePhone } from '../common/utils/phone.util';
import { maskPhone } from '../common/utils/masking.util';

/**
 * Admin-only management of WhatsApp sign-in: feature toggles, Cloud API
 * credentials, the OTP template and the OTP policy. Mounted under /settings so
 * further admin-managed settings can sit alongside it.
 */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/whatsapp')
@Roles('ADMIN')
export class WhatsappSettingsController {
  constructor(
    private readonly settings: WhatsappSettingsService,
    private readonly provider: WhatsappProviderService,
  ) {}

  @Get()
  get() {
    return this.settings.getForAdmin();
  }

  @Patch()
  @Audit({ action: 'UPDATE_WHATSAPP_SETTINGS', entityType: 'WhatsappSettings' })
  update(@Body() dto: UpdateWhatsappSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.update(dto, user.userId);
  }

  /**
   * Sends a real message with the *saved* configuration so an admin can
   * verify credentials and template wiring without registering a user. The
   * code is a throwaway and is not stored as a valid OTP.
   */
  @Post('test')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Audit({ action: 'TEST_WHATSAPP_SETTINGS', entityType: 'WhatsappSettings' })
  async test(@Body() dto: SendTestMessageDto) {
    const settings = await this.settings.getResolved();
    const phone = normalizePhone(dto.phone, settings.defaultCountryCode);
    if (!phone) throw new BadRequestException('Enter a valid WhatsApp number');

    const code = '0'.repeat(settings.otpLength);
    try {
      const result = await this.provider.sendOtp(settings, phone, code);
      return {
        id: 'default',
        success: true,
        provider: result.provider,
        to: maskPhone(phone),
        message:
          result.provider === 'CONSOLE'
            ? 'Console provider: the test code was written to the API server log, not sent over WhatsApp.'
            : 'Test message accepted by WhatsApp.',
      };
    } catch (err) {
      if (err instanceof WhatsappDeliveryError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }
}
