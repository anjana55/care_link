import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, eq, or } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import type { AutomationEndpoint, AutomationEndpointInput, AutomationEndpointTestResult, AutomationFunction, DataClass } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { automationEndpoints, automationFunctions } from '../database/schema';
import { decryptSecret, deriveKey, encryptSecret } from '../common/utils/secret-box.util';
import { AiProviderService, AiUnavailableError, type ModelTarget } from '../ai/ai-provider.service';
import { AiSettingsService } from '../ai/ai-settings.service';

type EndpointRow = typeof automationEndpoints.$inferSelect;

/** An endpoint ready to be called: numbers as numbers, the key decrypted. */
export interface ResolvedEndpoint extends ModelTarget {
  id: string;
  name: string;
  enabled: boolean;
  clearedFor: DataClass;
}

const MAX_ENDPOINTS = 20;

/**
 * The AI models agents can use (Settings > Automation > AI models). Each has
 * a clearance - the most sensitive class of data it may be sent - which
 * AgentModelService checks on every call.
 *
 * Settings > AI is left alone: it keeps running search and the staff
 * assistant. "Copy from Settings > AI" makes an endpoint from it, key
 * included, so an admin does not have to find the key again.
 */
@Injectable()
export class AutomationEndpointsService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly provider: AiProviderService,
    private readonly aiSettings: AiSettingsService,
  ) {
    const root = this.config.get<string>('SETTINGS_ENCRYPTION_KEY') || this.config.get<string>('JWT_REFRESH_SECRET') || '';
    this.encryptionKey = deriveKey(root, 'automation-endpoints');
  }

  private resolve(row: EndpointRow): ResolvedEndpoint {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      clearedFor: row.clearedFor,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: decryptSecret(row.apiKeyEncrypted, this.encryptionKey),
      temperature: row.temperature === null ? null : Number(row.temperature),
      maxTokens: row.maxTokens,
      timeoutMs: row.timeoutMs,
    };
  }

  private async row(id: string): Promise<EndpointRow> {
    const [row] = await this.db.select().from(automationEndpoints).where(eq(automationEndpoints.id, id)).limit(1);
    if (!row) throw new NotFoundException('AI model not found');
    return row;
  }

  /** For the router: null when the endpoint no longer exists. */
  async resolved(id: string | null | undefined): Promise<ResolvedEndpoint | null> {
    if (!id) return null;
    const [row] = await this.db.select().from(automationEndpoints).where(eq(automationEndpoints.id, id)).limit(1);
    return row ? this.resolve(row) : null;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.resolved(id)) !== null;
  }

  async list(): Promise<AutomationEndpoint[]> {
    const [rows, functions] = await Promise.all([
      this.db.select().from(automationEndpoints).orderBy(asc(automationEndpoints.name)),
      this.db.select({ key: automationFunctions.key, endpointId: automationFunctions.endpointId, fallbackEndpointId: automationFunctions.fallbackEndpointId }).from(automationFunctions),
    ]);
    return rows.map((row) => {
      const { apiKey, ...e } = this.resolve(row);
      return {
        ...e,
        apiKeySet: !!apiKey,
        apiKeyHint: apiKey ? `••••${apiKey.slice(-4)}` : null,
        usedBy: functions.filter((f) => f.endpointId === row.id || f.fallbackEndpointId === row.id).map((f) => f.key as AutomationFunction),
      };
    });
  }

  private clean(input: AutomationEndpointInput) {
    return {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.provider !== undefined && { provider: input.provider }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl.trim().replace(/\/+$/, '') }),
      ...(input.model !== undefined && { model: input.model.trim() }),
      ...(input.temperature !== undefined && { temperature: input.temperature === null ? null : input.temperature.toFixed(2) }),
      ...(input.maxTokens !== undefined && { maxTokens: input.maxTokens }),
      ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
      ...(input.clearedFor !== undefined && { clearedFor: input.clearedFor }),
    };
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const [taken] = await this.db.select({ id: automationEndpoints.id }).from(automationEndpoints).where(eq(automationEndpoints.name, name)).limit(1);
    if (taken && taken.id !== exceptId) throw new ConflictException('Another AI model already has this name');
  }

  /**
   * Adds an endpoint. With `copyDefault`, the provider, address, model, key
   * and limits come from Settings > AI and only the name is needed. Either
   * way it starts cleared for PUBLIC data unless the admin says otherwise.
   */
  async create(input: AutomationEndpointInput & { copyDefault?: boolean }, userId: string): Promise<AutomationEndpoint[]> {
    const count = (await this.db.select({ id: automationEndpoints.id }).from(automationEndpoints)).length;
    if (count >= MAX_ENDPOINTS) throw new BadRequestException(`No more than ${MAX_ENDPOINTS} AI models can be set up`);

    let base: Partial<typeof automationEndpoints.$inferInsert> = {};
    let apiKey = input.apiKey?.trim() || null;
    if (input.copyDefault) {
      const d = await this.aiSettings.getResolved();
      base = { provider: d.provider, baseUrl: d.baseUrl, model: d.model, temperature: d.temperature === null ? null : d.temperature.toFixed(2), maxTokens: d.maxTokens, timeoutMs: d.timeoutMs };
      apiKey = apiKey ?? d.apiKey;
    }
    const values = { ...base, ...this.clean(input) };
    if (!values.name) throw new BadRequestException('Give the AI model a name');
    if (!values.baseUrl || !values.model) throw new BadRequestException('Enter the address and the model name');
    if ((values.provider ?? 'OLLAMA') !== 'OLLAMA' && !apiKey) throw new BadRequestException('This provider needs an API key');
    await this.assertNameFree(values.name);

    await this.db.insert(automationEndpoints).values({
      ...values,
      id: uuid(),
      name: values.name,
      baseUrl: values.baseUrl,
      model: values.model,
      apiKeyEncrypted: apiKey ? encryptSecret(apiKey, this.encryptionKey) : null,
      updatedBy: userId,
    });
    return this.list();
  }

  async update(id: string, input: AutomationEndpointInput, userId: string): Promise<AutomationEndpoint[]> {
    const current = this.resolve(await this.row(id));
    const changes = this.clean(input);
    if (changes.name !== undefined) {
      if (!changes.name) throw new BadRequestException('Give the AI model a name');
      await this.assertNameFree(changes.name, id);
    }
    if (changes.baseUrl === '' || changes.model === '') throw new BadRequestException('Enter the address and the model name');
    const nextKey = input.clearApiKey ? null : input.apiKey?.trim() || current.apiKey;
    if ((changes.provider ?? current.provider) !== 'OLLAMA' && !nextKey) throw new BadRequestException('This provider needs an API key');

    await this.db
      .update(automationEndpoints)
      .set({
        ...changes,
        ...(input.clearApiKey ? { apiKeyEncrypted: null } : input.apiKey?.trim() ? { apiKeyEncrypted: encryptSecret(input.apiKey.trim(), this.encryptionKey) } : {}),
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(eq(automationEndpoints.id, id));
    return this.list();
  }

  /** Refused while an agent still points at it: unassign it first, so no agent is left without its model by surprise. */
  async remove(id: string): Promise<AutomationEndpoint[]> {
    await this.row(id);
    const users = await this.db
      .select({ key: automationFunctions.key })
      .from(automationFunctions)
      .where(or(eq(automationFunctions.endpointId, id), eq(automationFunctions.fallbackEndpointId, id)));
    if (users.length) throw new ConflictException('An agent still uses this AI model. Choose another model for it first.');
    await this.db.delete(automationEndpoints).where(eq(automationEndpoints.id, id));
    return this.list();
  }

  /** One short call with nothing personal in it, so an admin can check the endpoint before an agent relies on it. */
  async test(id: string): Promise<AutomationEndpointTestResult> {
    const endpoint = this.resolve(await this.row(id));
    const started = Date.now();
    try {
      await this.provider.chat(endpoint, { maxTokens: 64, messages: [{ role: 'user', content: 'Reply with the single word OK.' }] });
      return { ok: true, model: endpoint.model, latencyMs: Date.now() - started, message: 'The model answered.' };
    } catch (err) {
      const e = err as AiUnavailableError;
      return { ok: false, model: endpoint.model, latencyMs: Date.now() - started, message: e.detail ? `${e.message}: ${e.detail}` : e.message };
    }
  }
}
