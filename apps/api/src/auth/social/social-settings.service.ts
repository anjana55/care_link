import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../database/database.module';
import { socialAuthProviderSettings, socialProviderEnum, type SocialProvider } from '../../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../../common/utils/secret-box.util';
import { UpdateSocialProviderSettingsDto } from '../dto/update-social-provider-settings.dto';
import { socialRedirectUri } from './social-redirect.util';

type Row = typeof socialAuthProviderSettings.$inferSelect;

/** What the sign-in flow works with: the row, the decrypted secret, and the defaults filled in. */
export interface ResolvedProviderConfig {
  provider: SocialProvider;
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  tenant: string;
  apiVersion: string;
  /** Enabled AND complete - the only state in which the provider may be offered. */
  usable: boolean;
}

/** What the admin UI sees: no secret, only the fact that one is stored. */
export interface AdminProviderSettings {
  id: SocialProvider;
  provider: SocialProvider;
  enabled: boolean;
  clientId: string | null;
  clientSecretSet: boolean;
  clientSecretHint: string | null;
  tenant: string;
  apiVersion: string;
  redirectUri: string;
  usable: boolean;
  updatedAt: string | null;
}

const DEFAULT_TENANT = 'common';
const DEFAULT_FB_VERSION = 'v21.0';

/** Parses a provider from a URL segment: `google`, `Google` and `GOOGLE` all mean Google. */
export function parseSocialProvider(raw: string | undefined): SocialProvider {
  const upper = String(raw ?? '').toUpperCase();
  const match = socialProviderEnum.find((p) => p === upper);
  if (!match) throw new BadRequestException(`Unknown sign-in provider: ${String(raw ?? '')}`);
  return match;
}

/**
 * Owns the three admin-managed provider rows.
 *
 * Read on every request rather than cached, like the WhatsApp settings: it is a
 * handful of primary-key reads, and it means switching a provider off in an
 * incident takes effect on every API instance immediately.
 */
@Injectable()
export class SocialAuthSettingsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    // Same root as the WhatsApp token: SETTINGS_ENCRYPTION_KEY, falling back to the
    // refresh secret so a deployment that never set it still boots. Rotating the
    // fallback makes stored secrets undecryptable - the admin re-enters them.
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'social-auth-settings');
  }

  redirectUri(provider: SocialProvider) {
    return socialRedirectUri(this.config, provider);
  }

  /** Every provider's row, creating any that is missing from the bootstrap environment. */
  private async getRows(): Promise<Row[]> {
    let rows = await this.db.select().from(socialAuthProviderSettings);
    const missing = socialProviderEnum.filter((p) => !rows.some((r) => r.provider === p));
    if (missing.length) {
      for (const provider of missing) {
        const env = (suffix: string) => this.config.get<string>(`${provider}_${suffix}`) || undefined;
        const id = env('CLIENT_ID');
        const secret = env('CLIENT_SECRET');
        // ON DUPLICATE KEY keeps this safe if two instances race to create the row.
        await this.db
          .insert(socialAuthProviderSettings)
          .values({
            provider,
            // An environment that already had both set was offering the provider; keep it on.
            enabled: Boolean(id && secret),
            clientId: id ?? null,
            clientSecretEncrypted: secret ? encryptSecret(secret, this.encryptionKey) : null,
            tenant: provider === 'MICROSOFT' ? (env('TENANT') ?? DEFAULT_TENANT) : null,
            apiVersion: provider === 'FACEBOOK' ? (env('API_VERSION') ?? DEFAULT_FB_VERSION) : null,
          })
          .onDuplicateKeyUpdate({ set: { provider } });
      }
      rows = await this.db.select().from(socialAuthProviderSettings);
    }
    return rows;
  }

  private resolve(row: Row): ResolvedProviderConfig {
    const clientSecret = decryptSecret(row.clientSecretEncrypted, this.encryptionKey);
    return {
      provider: row.provider,
      enabled: row.enabled,
      clientId: row.clientId,
      clientSecret,
      tenant: row.tenant || DEFAULT_TENANT,
      apiVersion: row.apiVersion || DEFAULT_FB_VERSION,
      usable: row.enabled && Boolean(row.clientId) && Boolean(clientSecret),
    };
  }

  async getResolved(provider: SocialProvider): Promise<ResolvedProviderConfig> {
    const row = (await this.getRows()).find((r) => r.provider === provider);
    if (!row) throw new NotFoundException(`Unknown sign-in provider: ${provider}`);
    return this.resolve(row);
  }

  async getAllResolved(): Promise<ResolvedProviderConfig[]> {
    return (await this.getRows()).map((r) => this.resolve(r));
  }

  async getForAdmin(): Promise<AdminProviderSettings[]> {
    const rows = await this.getRows();
    return socialProviderEnum.map((p) => this.toAdmin(rows.find((r) => r.provider === p)!));
  }

  private toAdmin(row: Row): AdminProviderSettings {
    const cfg = this.resolve(row);
    return {
      id: row.provider,
      provider: row.provider,
      enabled: row.enabled,
      clientId: row.clientId,
      clientSecretSet: Boolean(cfg.clientSecret),
      clientSecretHint: cfg.clientSecret ? `••••${cfg.clientSecret.slice(-4)}` : null,
      tenant: cfg.tenant,
      apiVersion: cfg.apiVersion,
      redirectUri: this.redirectUri(row.provider),
      usable: cfg.usable,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  async update(provider: SocialProvider, dto: UpdateSocialProviderSettingsDto, updatedBy: string): Promise<AdminProviderSettings> {
    const current = await this.getResolved(provider);

    const nextClientId = dto.clientId !== undefined ? dto.clientId.trim() || null : current.clientId;
    const newSecret = dto.clientSecret?.trim() || null;
    const nextSecret = dto.clearClientSecret ? null : (newSecret ?? current.clientSecret);
    const nextEnabled = dto.enabled ?? current.enabled;
    const nextTenant = provider === 'MICROSOFT' ? (dto.tenant?.trim() || current.tenant) : null;
    const nextVersion = provider === 'FACEBOOK' ? (dto.apiVersion?.trim() || current.apiVersion) : null;

    // A secret belongs to one application. Keeping the old one against a new
    // client ID would silently pair two unrelated credentials, and the only
    // symptom would be every sign-in failing at the provider.
    if (current.clientId && nextClientId !== current.clientId && !newSecret && !dto.clearClientSecret) {
      throw new BadRequestException('Enter the client secret again when changing the client ID');
    }

    // Validate the *resulting* configuration so an admin cannot leave a
    // provider switched on with half a setup.
    if (nextEnabled) {
      const missing: string[] = [];
      if (!nextClientId) missing.push('client ID');
      if (!nextSecret) missing.push('client secret');
      if (missing.length) {
        throw new BadRequestException(`Cannot enable ${provider.toLowerCase()} sign-in without: ${missing.join(', ')}`);
      }
      const redirect = this.redirectUri(provider);
      if (this.config.get<string>('NODE_ENV') === 'production' && !/^https:\/\//i.test(redirect)) {
        throw new BadRequestException(
          `The callback URL (${redirect}) must use https in production - set PUBLIC_WEB_URL or SOCIAL_AUTH_CALLBACK_BASE_URL`,
        );
      }
    }

    const patch: Partial<typeof socialAuthProviderSettings.$inferInsert> = {
      enabled: nextEnabled,
      clientId: nextClientId,
      tenant: nextTenant,
      apiVersion: nextVersion,
      updatedBy,
      updatedAt: new Date(),
    };
    if (dto.clearClientSecret) patch.clientSecretEncrypted = null;
    else if (newSecret) patch.clientSecretEncrypted = encryptSecret(newSecret, this.encryptionKey);

    await this.db.update(socialAuthProviderSettings).set(patch).where(eq(socialAuthProviderSettings.provider, provider));
    return (await this.getForAdmin()).find((s) => s.provider === provider)!;
  }
}
