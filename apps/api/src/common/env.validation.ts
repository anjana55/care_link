import { plainToInstance } from 'class-transformer';
import { IsBooleanString, IsEnum, IsNumberString, IsOptional, IsString, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
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

  // All optional, even in production: EmailService degrades to logging
  // verification links to the console when SMTP_HOST is unset, rather than
  // the whole app refusing to boot over an unrelated feature. It does log
  // an error at startup in production if left unset - see EmailService.
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

  @IsOptional()
  @IsBooleanString()
  WHATSAPP_ENABLED?: string;

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
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }
  return validated;
}
