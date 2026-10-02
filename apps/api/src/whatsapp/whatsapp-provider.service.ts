import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toWhatsappRecipient } from '../common/utils/phone.util';
import type { ResolvedWhatsappSettings } from './whatsapp-settings.service';

export class WhatsappDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsappDeliveryError';
  }
}

export interface SendResult {
  provider: 'META_CLOUD' | 'CONSOLE';
  messageId?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Delivers the OTP. META_CLOUD sends the admin-configured, pre-approved
 * *authentication template* through the WhatsApp Business Cloud API - a
 * template (not free text) is the only message type WhatsApp lets a business
 * send to a user who hasn't messaged it in the last 24 hours, which is
 * exactly the situation for a login code.
 *
 * CONSOLE exists so the whole flow is testable locally with no Meta account.
 * It is refused in production: logging a login code to server output would
 * hand it to anyone with log access.
 */
@Injectable()
export class WhatsappProviderService {
  private readonly logger = new Logger(WhatsappProviderService.name);

  constructor(private readonly config: ConfigService) {}

  isDevConsole(settings: Pick<ResolvedWhatsappSettings, 'provider'>): boolean {
    return settings.provider === 'CONSOLE' && this.config.get<string>('NODE_ENV') !== 'production';
  }

  async sendOtp(settings: ResolvedWhatsappSettings, toE164: string, code: string): Promise<SendResult> {
    if (settings.provider === 'CONSOLE') {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new WhatsappDeliveryError('WhatsApp delivery is not configured');
      }
      this.logger.log(`[WHATSAPP CONSOLE] OTP for ${toE164}: ${code}`);
      return { provider: 'CONSOLE' };
    }
    return this.sendViaCloudApi(settings, toE164, code);
  }

  private async sendViaCloudApi(s: ResolvedWhatsappSettings, toE164: string, code: string): Promise<SendResult> {
    if (!s.phoneNumberId || !s.accessToken) {
      throw new WhatsappDeliveryError('WhatsApp delivery is not configured');
    }

    // Authentication templates carry the code in the body and, when the
    // template has a "copy code" button, again as that button's parameter.
    const components: unknown[] = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
    if (s.templateHasCopyCodeButton) {
      components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
    }

    const url = `${s.apiBaseUrl}/${s.apiVersion}/${s.phoneNumberId}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toWhatsappRecipient(toE164),
          type: 'template',
          template: { name: s.templateName, language: { code: s.templateLanguage }, components },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Never include the request (it carries the token) or the code in logs.
      this.logger.error(`WhatsApp Cloud API request failed: ${(err as Error).name}`);
      throw new WhatsappDeliveryError('Could not reach WhatsApp - please try again shortly');
    }

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: number } };
        if (body.error) detail = `${body.error.code ?? res.status}: ${body.error.message ?? 'unknown error'}`;
      } catch {
        /* non-JSON error body */
      }
      this.logger.error(`WhatsApp Cloud API rejected the message (${detail})`);
      throw new WhatsappDeliveryError('WhatsApp could not deliver the code - check the number and try again');
    }

    const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { provider: 'META_CLOUD', messageId: body.messages?.[0]?.id };
  }
}
