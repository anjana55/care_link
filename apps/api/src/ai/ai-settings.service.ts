import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import type { AdminAiSettings, AiFeatureStatus, AiProvider } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { aiSettings } from '../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

const SETTINGS_ID = 'default';

type AiSettingsRow = typeof aiSettings.$inferSelect;

/** What the AI features run with: numbers as numbers, the key decrypted. */
export interface ResolvedAiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  temperature: number | null;
  maxTokens: number;
  timeoutMs: number;
  candidatePoolSize: number;
  publicSearchEnabled: boolean;
  staffMatchingEnabled: boolean;
  staffAssistantEnabled: boolean;
  searchPrompt: string | null;
  assistantPrompt: string | null;
  updatedAt: Date | null;
}

export type AiFeature = 'publicSearch' | 'staffMatching' | 'staffAssistant';

/** Provider defaults so switching provider in the form gives a working starting point. */
export const PROVIDER_DEFAULT_URLS: Record<AiProvider, string> = {
  OLLAMA: 'http://localhost:11434',
  OPENAI_COMPATIBLE: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
};

/**
 * Owns the single Settings > AI row. Read per use, uncached, like the other
 * settings services: one primary-key lookup, and switching AI off in an
 * incident takes effect on the very next request on every instance.
 */
@Injectable()
export class AiSettingsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'ai-settings');
  }

  private async getRow(): Promise<AiSettingsRow> {
    const [existing] = await this.db.select().from(aiSettings).where(eq(aiSettings.id, SETTINGS_ID)).limit(1);
    if (existing) return existing;
    await this.db.insert(aiSettings).values({ id: SETTINGS_ID }).onDuplicateKeyUpdate({ set: { id: SETTINGS_ID } });
    const [created] = await this.db.select().from(aiSettings).where(eq(aiSettings.id, SETTINGS_ID)).limit(1);
    return created;
  }

  private resolve(row: AiSettingsRow): ResolvedAiSettings {
    return {
      enabled: row.enabled,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: decryptSecret(row.apiKeyEncrypted, this.encryptionKey),
      temperature: row.temperature === null ? null : Number(row.temperature),
      maxTokens: row.maxTokens,
      timeoutMs: row.timeoutMs,
      candidatePoolSize: row.candidatePoolSize,
      publicSearchEnabled: row.publicSearchEnabled,
      staffMatchingEnabled: row.staffMatchingEnabled,
      staffAssistantEnabled: row.staffAssistantEnabled,
      searchPrompt: row.searchPrompt,
      assistantPrompt: row.assistantPrompt,
      updatedAt: row.updatedAt ?? null,
    };
  }

  async getResolved(): Promise<ResolvedAiSettings> {
    return this.resolve(await this.getRow());
  }

  /** The settings, but only when the master switch and this feature's switch are both on. */
  async forFeature(feature: AiFeature): Promise<ResolvedAiSettings | null> {
    const s = await this.getResolved();
    if (!s.enabled) return null;
    const on = feature === 'publicSearch' ? s.publicSearchEnabled : feature === 'staffMatching' ? s.staffMatchingEnabled : s.staffAssistantEnabled;
    return on ? s : null;
  }

  async featureStatus(): Promise<AiFeatureStatus> {
    const s = await this.getResolved();
    return { matching: s.enabled && s.staffMatchingEnabled, assistant: s.enabled && s.staffAssistantEnabled };
  }

  async getForAdmin(): Promise<AdminAiSettings> {
    const s = await this.getResolved();
    const { apiKey, updatedAt, ...rest } = s;
    return {
      ...rest,
      apiKeySet: !!apiKey,
      apiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : null,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    };
  }

  async update(dto: UpdateAiSettingsDto, updatedBy: string): Promise<AdminAiSettings> {
    const current = await this.getResolved();
    const { apiKey, clearApiKey, ...fields } = dto;
    const changes = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<UpdateAiSettingsDto>;

    const next = { ...current, ...changes };
    const nextKey = clearApiKey ? null : apiKey?.trim() || current.apiKey;
    if (next.enabled) {
      if (!next.model?.trim()) throw new BadRequestException('Enter the model name before switching AI on');
      if (next.provider !== 'OLLAMA' && !nextKey) {
        throw new BadRequestException('This provider needs an API key before AI can be switched on');
      }
    }

    const patch: Partial<typeof aiSettings.$inferInsert> = { updatedBy, updatedAt: new Date() };
    if (changes.enabled !== undefined) patch.enabled = changes.enabled;
    if (changes.provider !== undefined) patch.provider = changes.provider;
    if (changes.baseUrl !== undefined) patch.baseUrl = changes.baseUrl.trim().replace(/\/+$/, '');
    if (changes.model !== undefined) patch.model = changes.model.trim();
    if (dto.temperature !== undefined) patch.temperature = dto.temperature === null ? null : dto.temperature.toFixed(2);
    if (changes.maxTokens !== undefined) patch.maxTokens = changes.maxTokens;
    if (changes.timeoutMs !== undefined) patch.timeoutMs = changes.timeoutMs;
    if (changes.candidatePoolSize !== undefined) patch.candidatePoolSize = changes.candidatePoolSize;
    if (changes.publicSearchEnabled !== undefined) patch.publicSearchEnabled = changes.publicSearchEnabled;
    if (changes.staffMatchingEnabled !== undefined) patch.staffMatchingEnabled = changes.staffMatchingEnabled;
    if (changes.staffAssistantEnabled !== undefined) patch.staffAssistantEnabled = changes.staffAssistantEnabled;
    if (dto.searchPrompt !== undefined) patch.searchPrompt = dto.searchPrompt?.trim() || null;
    if (dto.assistantPrompt !== undefined) patch.assistantPrompt = dto.assistantPrompt?.trim() || null;
    if (clearApiKey) patch.apiKeyEncrypted = null;
    else if (apiKey?.trim()) patch.apiKeyEncrypted = encryptSecret(apiKey.trim(), this.encryptionKey);

    await this.getRow();
    await this.db.update(aiSettings).set(patch).where(eq(aiSettings.id, SETTINGS_ID));
    return this.getForAdmin();
  }
}
