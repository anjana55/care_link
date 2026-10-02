import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { whatsappAuthSettings } from '../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';
import { UpdateWhatsappSettingsDto } from './dto/update-whatsapp-settings.dto';

const SETTINGS_ID = 'default';

export type WhatsappSettingsRow = typeof whatsappAuthSettings.$inferSelect;

/** What the delivery + OTP services work with: the row plus the decrypted token. */
export interface ResolvedWhatsappSettings extends Omit<WhatsappSettingsRow, 'accessTokenEncrypted'> {
  accessToken: string | null;
}

/** What the admin UI sees: the row minus the secret, plus a masked hint that one is stored. */
export type AdminWhatsappSettings = Omit<WhatsappSettingsRow, 'accessTokenEncrypted'> & {
  accessTokenSet: boolean;
  accessTokenHint: string | null;
};

/**
 * Owns the single admin-managed settings row. Read on every request rather
 * than cached - it's one primary-key lookup, and it means an admin's change
 * (including flipping the master switch off in an incident) takes effect
 * immediately across every API instance.
 */
@Injectable()
export class WhatsappSettingsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    // SETTINGS_ENCRYPTION_KEY is the proper source. Falling back to the JWT
    // refresh secret keeps a deployment that hasn't set it working (rather
    // than refusing to boot), at the cost that rotating that secret makes the
    // stored token undecryptable - the admin just re-enters it.
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'whatsapp-settings');
  }

  /** Returns the row, creating it from bootstrap env defaults on first use. */
  private async getRow(): Promise<WhatsappSettingsRow> {
    const [existing] = await this.db.select().from(whatsappAuthSettings).where(eq(whatsappAuthSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;

    const env = (k: string) => this.config.get<string>(k) || undefined;
    const token = env('WHATSAPP_ACCESS_TOKEN');
    const provider = env('WHATSAPP_PROVIDER') === 'META_CLOUD' || token ? 'META_CLOUD' : 'CONSOLE';
    // ON DUPLICATE KEY keeps this safe if two instances race to create the row.
    await this.db
      .insert(whatsappAuthSettings)
      .values({
        id: SETTINGS_ID,
        enabled: env('WHATSAPP_ENABLED') === 'true',
        provider,
        apiVersion: env('WHATSAPP_API_VERSION') ?? 'v21.0',
        phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') ?? null,
        businessAccountId: env('WHATSAPP_BUSINESS_ACCOUNT_ID') ?? null,
        accessTokenEncrypted: token ? encryptSecret(token, this.encryptionKey) : null,
        templateName: env('WHATSAPP_TEMPLATE_NAME') ?? 'carelink_otp',
        templateLanguage: env('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'en',
      })
      .onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });

    const [created] = await this.db.select().from(whatsappAuthSettings).where(eq(whatsappAuthSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  async getResolved(): Promise<ResolvedWhatsappSettings> {
    const { accessTokenEncrypted, ...rest } = await this.getRow();
    return { ...rest, accessToken: decryptSecret(accessTokenEncrypted, this.encryptionKey) };
  }

  async getForAdmin(): Promise<AdminWhatsappSettings> {
    const { accessTokenEncrypted, ...rest } = await this.getRow();
    const token = decryptSecret(accessTokenEncrypted, this.encryptionKey);
    return {
      ...rest,
      accessTokenSet: !!token,
      accessTokenHint: token ? `••••${token.slice(-4)}` : null,
    };
  }

  async update(dto: UpdateWhatsappSettingsDto, updatedBy: string): Promise<AdminWhatsappSettings> {
    const current = await this.getResolved();
    const { accessToken, clearAccessToken, ...fields } = dto;

    // Validate the *resulting* configuration, not just the changed fields, so
    // an admin can't leave the feature switched on with half a config.
    const next = { ...current, ...stripUndefined(fields) };
    const nextToken = clearAccessToken ? null : (accessToken?.trim() || current.accessToken);
    this.assertConsistent(next, nextToken);

    const patch: Partial<typeof whatsappAuthSettings.$inferInsert> = {
      ...stripUndefined(fields),
      updatedBy,
      updatedAt: new Date(),
    };
    if (clearAccessToken) {
      patch.accessTokenEncrypted = null;
    } else if (accessToken && accessToken.trim()) {
      patch.accessTokenEncrypted = encryptSecret(accessToken.trim(), this.encryptionKey);
    }
    // Stored trimmed so a pasted trailing space can't break the Graph API URL.
    for (const key of ['apiBaseUrl', 'apiVersion', 'phoneNumberId', 'businessAccountId', 'templateName', 'templateLanguage'] as const) {
      if (typeof patch[key] === 'string') (patch as Record<string, unknown>)[key] = (patch[key] as string).trim() || null;
    }
    if (typeof patch.apiBaseUrl === 'string') patch.apiBaseUrl = patch.apiBaseUrl.replace(/\/+$/, '');

    await this.getRow();
    await this.db.update(whatsappAuthSettings).set(patch).where(eq(whatsappAuthSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }

  private assertConsistent(s: Omit<ResolvedWhatsappSettings, 'accessToken'>, token: string | null) {
    if (!s.enabled) return;

    if (s.provider === 'CONSOLE' && this.config.get<string>('NODE_ENV') === 'production') {
      throw new BadRequestException(
        'The console provider only logs codes and is for development - choose Meta Cloud API to enable WhatsApp sign-in in production',
      );
    }
    if (s.provider === 'META_CLOUD') {
      const missing: string[] = [];
      if (!s.phoneNumberId) missing.push('phone number ID');
      if (!token) missing.push('access token');
      if (!s.templateName) missing.push('template name');
      if (missing.length) {
        throw new BadRequestException(`Cannot enable WhatsApp sign-in without: ${missing.join(', ')}`);
      }
      if (!/^https:\/\//i.test(s.apiBaseUrl) && this.config.get<string>('NODE_ENV') === 'production') {
        throw new BadRequestException('The API base URL must use https in production');
      }
    }
    if (!s.caregiverEnabled && !s.customerEnabled) {
      throw new BadRequestException('Enable WhatsApp sign-in for at least one of caregivers or customers');
    }
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
