import { plainToInstance } from 'class-transformer';
import { IsBooleanString, IsEnum, IsNumberString, IsOptional, IsString, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsNumberString()
  PORT = '3001';

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  STORAGE_LOCAL_ROOT!: string;

  // All optional, and only *bootstrap* the admin-managed mail settings
  // (Settings > Email, EmailSettingsService) the first time the API needs
  // them - after that the database row is the source of truth. Until a
  // server is configured, EmailService logs verification links to the
  // console rather than the whole app refusing to boot.
  @IsOptional()
  @IsString()
  SMTP_HOST?: string;

  @IsOptional()
  @IsNumberString()
  SMTP_PORT?: string;

  @IsOptional()
  @IsBooleanString()
  SMTP_SECURE?: string;

  @IsOptional()
  @IsString()
  SMTP_USER?: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD?: string;

  @IsOptional()
  @IsString()
  SMTP_FROM?: string;

  // WhatsApp sign-in. Everything here is optional and only *bootstraps* the
  // admin-managed settings row the first time the API runs (see
  // WhatsappSettingsService) - after that, the admin UI (Settings > WhatsApp
  // sign-in) is the source of truth and these are ignored.
  //
  // SETTINGS_ENCRYPTION_KEY encrypts the stored WhatsApp access token at rest.
  // If unset, a key derived from JWT_REFRESH_SECRET is used instead.
  @IsOptional()
  @IsString()
  SETTINGS_ENCRYPTION_KEY?: string;

  // When "true", POST /auth/login without a `portal` is rejected. Off by
  // default so web apps that predate the field keep working during a rollout.
  @IsOptional()
  @IsBooleanString()
  AUTH_REQUIRE_LOGIN_PORTAL?: string;

  // Push notifications to the mobile app (PushService). On unless "false".
  @IsOptional()
  @IsBooleanString()
  PUSH_ENABLED?: string;

  // Only needed when the Expo project has "enhanced push security" turned on.
  @IsOptional()
  @IsString()
  EXPO_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsBooleanString()
  WHATSAPP_ENABLED?: string;

  /** The API docs (/docs) are off in production unless this is "true". */
  @IsOptional()
  @IsBooleanString()
  API_DOCS_ENABLED?: string;

  /**
   * Which proxies may tell the API the visitor's address (Express "trust
   * proxy"). The default trusts the local and private networks, which is
   * where nginx sits in the Docker setup. Set "false" with no proxy in front.
   */
  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;

  @IsOptional()
  @IsEnum({ META_CLOUD: 'META_CLOUD', CONSOLE: 'CONSOLE' })
  WHATSAPP_PROVIDER?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_API_VERSION?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_PHONE_NUMBER_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_ACCESS_TOKEN?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_TEMPLATE_NAME?: string;

  @IsOptional()
  @IsString()
  WHATSAPP_TEMPLATE_LANGUAGE?: string;

  // Google / Microsoft / Facebook sign-in, offered to a caregiver once the
  // unified registration form has been submitted. A provider is offered only
  // when BOTH its client id and secret are set, so a partially configured
  // environment degrades to "that button is absent" rather than to a broken
  // sign-in (see SocialProviderRegistry.available).
  // Redirect URIs are {SOCIAL_AUTH_CALLBACK_BASE_URL}/auth/social/{provider}/callback.
  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_CLIENT_SECRET?: string;

  @IsOptional()
  @IsString()
  MICROSOFT_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  MICROSOFT_CLIENT_SECRET?: string;

  // 'common' for any Microsoft work/school account, 'organizations' for
  // work/school only, 'consumers' for personal accounts.
  @IsOptional()
  @IsString()
  MICROSOFT_TENANT?: string;

  @IsOptional()
  @IsString()
  FACEBOOK_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  FACEBOOK_CLIENT_SECRET?: string;

  // The public origin the providers send the caregiver back to. Must be the
  // value registered in each provider's console BYTE FOR BYTE, because the
  // token exchange is rejected otherwise. Behind nginx that origin is
  // https://<domain>/api - nginx strips the /api prefix before proxying to the
  // API container, so the redirect_uri still has to carry it. Left unset it
  // falls back to {PUBLIC_WEB_URL}/api, which is right for the default
  // single-origin setup and wrong anywhere the API is mounted elsewhere.
  @IsOptional()
  @IsString()
  SOCIAL_AUTH_CALLBACK_BASE_URL?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  if (validated.NODE_ENV === NodeEnv.Production) {
    const weak = weakSecrets(validated);
    if (weak.length) throw new Error(`Invalid environment configuration: ${weak.join('; ')}`);
  }
  return validated;
}

/** Placeholder values from .env.example, and anything else too short to sign tokens safely. */
const PLACEHOLDER = /change-?me|your-?secret|replace-?(this|me)/i;
const MIN_SECRET_LENGTH = 32;

/**
 * In production the token-signing keys must be long, distinct and not the
 * examples: anyone who knows a key can sign themselves in as anybody.
 * setup.sh generates 64-character random keys, so a real install passes.
 */
export function weakSecrets(env: Pick<EnvironmentVariables, 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'SETTINGS_ENCRYPTION_KEY'>): string[] {
  const out: string[] = [];
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'SETTINGS_ENCRYPTION_KEY'] as const) {
    const v = env[name];
    // Optional (a key is derived from the refresh secret when it is blank).
    if (!v && name === 'SETTINGS_ENCRYPTION_KEY') continue;
    if (!v || v.length < MIN_SECRET_LENGTH) out.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters (try: openssl rand -base64 48)`);
    else if (PLACEHOLDER.test(v)) out.push(`${name} is still the example value - generate a new one (openssl rand -base64 48)`);
  }
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) out.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  return out;
}
