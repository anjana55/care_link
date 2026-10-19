import { Injectable, Logger } from '@nestjs/common';
import { buildRequest, parseResponse, type ChatRequest, type ChatResult } from './ai-protocol';
import type { ResolvedAiSettings } from './ai-settings.service';

/** The model could not be reached or answered with an error. Features fall back rather than fail. */
export class AiUnavailableError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
  }
}

/** What a model has refused, learned from its own 400 errors. */
interface Quirks {
  noTemperature?: boolean;
  maxCompletionTokens?: boolean;
}

/**
 * Reads a 400 from the provider for a parameter it does not accept, and says
 * how to change the request so the retry can succeed. Null when the error is
 * about something else (a bad key, an unknown model...) - those are real
 * configuration problems and go back to the admin as they are.
 *
 * Seen in practice: newer Anthropic models answer "`temperature` is
 * deprecated for this model"; OpenAI reasoning models reject temperature and
 * want `max_completion_tokens` instead of `max_tokens`.
 */
export function quirkFromError(status: number, body: string, current: Quirks): Quirks | null {
  if (status !== 400) return null;
  const text = body.toLowerCase();
  if (!current.maxCompletionTokens && text.includes('max_completion_tokens')) return { ...current, maxCompletionTokens: true };
  if (!current.noTemperature && text.includes('temperature')) return { ...current, noTemperature: true };
  return null;
}

/**
 * The one place that talks to a model. Every call carries the admin's
 * timeout, and the API key travels only in headers - it is never logged,
 * echoed back or put in an error message.
 *
 * Models differ in which optional parameters they accept. Rather than make
 * the admin know that, a parameter the model refuses is dropped (or renamed)
 * and the call retried; what was learned is remembered per provider + model
 * for the life of the process, so later calls do not pay for it again.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);
  private readonly quirks = new Map<string, Quirks>();

  async chat(settings: ResolvedAiSettings, req: Omit<ChatRequest, 'temperature' | 'maxTokens'> & Partial<Pick<ChatRequest, 'temperature' | 'maxTokens'>>): Promise<ChatResult> {
    const key = `${settings.provider}|${settings.baseUrl}|${settings.model}`;
    let quirks = this.quirks.get(key) ?? {};

    // At most two parameters to learn, so at most three attempts.
    for (let attempt = 0; ; attempt++) {
      const temperature = quirks.noTemperature ? null : (req.temperature !== undefined ? req.temperature : settings.temperature);
      const call = buildRequest(
        { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, apiKey: settings.apiKey },
        { maxTokens: settings.maxTokens, ...req, temperature, tokenField: quirks.maxCompletionTokens ? 'max_completion_tokens' : 'max_tokens' },
      );
      const { status, text } = await this.post(settings, call);

      if (status >= 200 && status < 300) {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new AiUnavailableError('The AI model sent a reply that was not JSON');
        }
        return parseResponse(settings.provider, data);
      }

      const learned = attempt < 2 ? quirkFromError(status, text, quirks) : null;
      if (learned) {
        this.logger.log(`AI model ${settings.model} refused a parameter; retrying (${JSON.stringify(learned)})`);
        quirks = learned;
        this.quirks.set(key, quirks);
        continue;
      }

      // The provider's own error text helps an admin fix the setup, but is
      // trimmed and only ever surfaced on the admin test route.
      const detail = text.slice(0, 300);
      this.logger.warn(`AI provider ${settings.provider} answered ${status}: ${detail}`);
      throw new AiUnavailableError(`The AI model answered with an error (HTTP ${status})`, detail);
    }
  }

  private async post(settings: ResolvedAiSettings, call: { url: string; headers: Record<string, string>; body: Record<string, unknown> }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const res = await fetch(call.url, { method: 'POST', headers: call.headers, body: JSON.stringify(call.body), signal: controller.signal });
      return { status: res.status, text: await res.text() };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      this.logger.warn(`AI request to ${settings.provider} failed: ${aborted ? 'timed out' : (err as Error)?.message}`);
      throw new AiUnavailableError(aborted ? 'The AI model took too long to answer' : 'The AI model could not be reached');
    } finally {
      clearTimeout(timer);
    }
  }
}
