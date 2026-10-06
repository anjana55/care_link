import type { ConfigService } from '@nestjs/config';
import type { SocialProvider } from '../../database/schema';

/**
 * The redirect URI an admin registers with a provider, and that the authorize
 * and token-exchange calls must repeat byte for byte.
 *
 * Always the lowercase provider name: the URL is case-sensitive to Google,
 * Microsoft and Facebook, and the settings screen shows exactly this value to
 * be pasted into their consoles.
 */
export function socialRedirectUri(config: ConfigService, provider: SocialProvider): string {
  const web = (config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/$/, '');
  const base = (config.get<string>('SOCIAL_AUTH_CALLBACK_BASE_URL') ?? `${web}/api`).replace(/\/$/, '');
  return `${base}/auth/social/${provider.toLowerCase()}/callback`;
}
