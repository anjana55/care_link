import { Injectable, Logger } from '@nestjs/common';
import { isClearedFor, type AutomationFunction, type DataClass } from '@care-platform/shared';
import { AiProviderService, AiUnavailableError } from '../ai/ai-provider.service';
import type { ChatRequest, ChatResult } from '../ai/ai-protocol';
import { AutomationService } from './automation.service';
import { AutomationEndpointsService, type ResolvedEndpoint } from './automation-endpoints.service';

/**
 * No endpoint this agent has is allowed to see data of this class. Nothing
 * was sent. The agent treats it like any other "no model": the step goes to
 * staff.
 */
export class AiNotClearedError extends AiUnavailableError {}

export interface AgentChatRequest extends Omit<ChatRequest, 'temperature' | 'maxTokens'>, Partial<Pick<ChatRequest, 'temperature' | 'maxTokens'>> {
  function: AutomationFunction;
  /**
   * The most sensitive class of data anywhere in `messages` (maxDataClass of
   * what the agent's tools returned). Required, with no default: a caller
   * must say what it is sending.
   */
  dataClass: DataClass;
}

export interface AgentChatResult extends ChatResult {
  /** What answered, for the decision log. */
  endpointName: string;
  model: string;
}

/** Failed calls within this window trip the function. */
export const TRIP_AFTER_FAILURES = 5;
export const TRIP_WINDOW_MS = 10 * 60 * 1000;

/**
 * The only way an agent reaches a model. It enforces the data-class rule in
 * code - a prompt is sent only to an endpoint cleared for the most sensitive
 * data in it, whatever the prompt itself says - falls back to the agent's
 * backup model when the main one fails, and trips the function to manual
 * when its models keep failing.
 */
@Injectable()
export class AgentModelService {
  private readonly logger = new Logger(AgentModelService.name);
  /** Recent failure times per function. Per process: a trip needs five failures seen by one instance. */
  private readonly failures = new Map<AutomationFunction, number[]>();

  constructor(
    private readonly automation: AutomationService,
    private readonly endpoints: AutomationEndpointsService,
    private readonly provider: AiProviderService,
  ) {}

  /** The endpoints this function may use for data of this class, main model first. */
  async candidates(fn: AutomationFunction, dataClass: DataClass): Promise<ResolvedEndpoint[]> {
    const assigned = await this.automation.functionEndpoints(fn);
    const both = await Promise.all([this.endpoints.resolved(assigned.endpointId), this.endpoints.resolved(assigned.fallbackEndpointId)]);
    return both.filter((e): e is ResolvedEndpoint => !!e && e.enabled && isClearedFor(e.clearedFor, dataClass));
  }

  async chat(req: AgentChatRequest): Promise<AgentChatResult> {
    const { function: fn, dataClass, ...chat } = req;
    const candidates = await this.candidates(fn, dataClass);
    if (!candidates.length) {
      throw new AiNotClearedError(`No AI model set up for ${fn} is cleared for ${dataClass} data`);
    }

    let last: AiUnavailableError | null = null;
    for (const endpoint of candidates) {
      try {
        const result = await this.provider.chat(endpoint, chat);
        this.failures.delete(fn);
        return { ...result, endpointName: endpoint.name, model: endpoint.model };
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        last = err;
        this.logger.warn(`${fn}: AI model "${endpoint.name}" failed (${err.message})`);
      }
    }
    await this.recordFailure(fn, last!);
    throw last!;
  }

  private async recordFailure(fn: AutomationFunction, err: AiUnavailableError) {
    const now = Date.now();
    const recent = [...(this.failures.get(fn) ?? []), now].filter((t) => now - t <= TRIP_WINDOW_MS);
    this.failures.set(fn, recent);
    if (recent.length >= TRIP_AFTER_FAILURES) {
      this.failures.delete(fn);
      await this.automation.trip(fn, `Its AI models failed ${recent.length} times in ${TRIP_WINDOW_MS / 60000} minutes (last: ${err.message})`);
    }
  }
}
