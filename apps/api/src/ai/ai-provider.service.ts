import { Injectable, Logger } from '@nestjs/common';
import { buildRequest, parseResponse, type ChatRequest, type ChatResult } from './ai-protocol';
import type { ResolvedAiSettings } from './ai-settings.service';

/** The model could not be reached or answered with an error. Features fall back rather than fail. */
export class AiUnavailableError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
  }
}

/**
 * The one place that talks to a model. Every call carries the admin's
 * timeout, and the API key travels only in headers - it is never logged,
 * echoed back or put in an error message.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  async chat(settings: ResolvedAiSettings, req: Omit<ChatRequest, 'temperature' | 'maxTokens'> & Partial<Pick<ChatRequest, 'temperature' | 'maxTokens'>>): Promise<ChatResult> {
    const call = buildRequest(
      { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey },
      { temperature: settings.temperature, maxTokens: settings.maxTokens, ...req },
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    let res: Response;
    try {
      res = await fetch(call.url, { method: 'POST', headers: call.headers, body: JSON.stringify(call.body), signal: controller.signal });
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(`AI request to ${settings.provider} failed: ${aborted ? 'timed out' : (err as Error)?.message}`);
      throw new AiUnavailableError(aborted ? 'The AI model took too long to answer' : 'The AI model could not be reached');
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      // The provider's own error text helps an admin fix the setup, but is
      // trimmed and only ever surfaced on the admin test route.
      const detail = text.slice(0, 300);
      this.logger.warn(`AI provider ${settings.provider} answered ${res.status}: ${detail}`);
      throw new AiUnavailableError(`The AI model answered with an error (HTTP ${res.status})`, detail);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiUnavailableError('The AI model sent a reply that was not JSON');
    }
    return parseResponse(settings.provider, data);
  }
}
