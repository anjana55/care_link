import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toWhatsappRecipient } from '../common/utils/phone.util';
import type { ResolvedWhatsappSettings } from './whatsapp-settings.service';

export class WhatsappDeliveryError extends Error {
  constructor(
    message: string,
    /**
     * Meta's own error code and text, when the request got far enough to be
     * rejected on its merits. Safe to surface: the Graph API error body
     * echoes neither the access token nor the code being sent, and the only
     * caller that shows this is the ADMIN-only settings screen.
     *
     * Without it a credential failure and a wrong recipient number look
     * identical to the admin - both arrive as "could not deliver the code,
     * check the number" - which sends them debugging the one thing that
     * isn't broken.
     */
    readonly detail?: string,
  ) {
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
      let code: number | undefined;
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: number } };
        if (body.error) {
          code = body.error.code;
          detail = `${code ?? res.status}: ${body.error.message ?? 'unknown error'}`;
        }
      } catch {
        /* non-JSON error body */
      }
      this.logger.error(`WhatsApp Cloud API rejected the message (${detail})`);

      // 190 and 190-series are OAuth failures: the token is expired, revoked,
      // or lacks the whatsapp_business_messaging permission. Meta rejects those
      // before it ever looks at the recipient, so telling the admin to check
      // the phone number would send them after the wrong problem entirely.
      const authFailure = code === 190 || code === 191 || code === 463;
      throw new WhatsappDeliveryError(
        authFailure
          ? 'WhatsApp rejected the access token - re-enter a current token in the field above and save'
          : 'WhatsApp could not deliver the code - check the number and try again',
        detail,
      );
    }

    const body = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { provider: 'META_CLOUD', messageId: body.messages?.[0]?.id };
  }
}
