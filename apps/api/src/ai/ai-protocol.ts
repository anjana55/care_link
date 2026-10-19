import type { AiProvider } from '@care-platform/shared';

/**
 * The provider-neutral chat shape every AI feature speaks, and the pure
 * translations to and from each provider's wire format. Kept free of I/O so the
 * mapping - which is where provider bugs live - is unit-tested without a model.
 */

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

/** A JSON-schema described function the model may call. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Ask for a single JSON object back. Providers without a JSON mode get it via the prompt. */
  json?: boolean;
  temperature: number;
  maxTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ChatToolCall[];
}

export interface ProviderConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export interface HttpCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let counter = 0;
/** Ollama does not id its tool calls; the transcript needs one to pair results with calls. */
function localToolCallId() {
  counter = (counter + 1) % 1_000_000;
  return `call_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, '');
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// --- building requests -------------------------------------------------------

export function buildRequest(cfg: ProviderConfig, req: ChatRequest): HttpCall {
  switch (cfg.provider) {
    case 'OLLAMA':
      return buildOllama(cfg, req);
    case 'OPENAI_COMPATIBLE':
      return buildOpenAi(cfg, req);
    case 'ANTHROPIC':
      return buildAnthropic(cfg, req);
  }
}

function buildOllama(cfg: ProviderConfig, req: ChatRequest): HttpCall {
  const messages = req.messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
    }
    if (m.role === 'tool') return { role: 'tool', content: m.content, tool_name: m.name };
    return { role: m.role, content: m.content };
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${trimSlash(cfg.baseUrl)}/api/chat`,
    headers,
    body: {
      model: cfg.model,
      messages,
      stream: false,
      ...(req.tools?.length ? { tools: req.tools.map(toOpenAiTool) } : {}),
      ...(req.json ? { format: 'json' } : {}),
      options: { temperature: req.temperature, num_predict: req.maxTokens },
    },
  };
}

function toOpenAiTool(t: ToolSpec) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
}

function buildOpenAi(cfg: ProviderConfig, req: ChatRequest): HttpCall {
  const messages = req.messages.map((m) => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content || (m.toolCalls?.length ? null : ''),
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
          : {}),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${trimSlash(cfg.baseUrl)}/chat/completions`,
    headers,
    body: {
      model: cfg.model,
      messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      ...(req.tools?.length ? { tools: req.tools.map(toOpenAiTool) } : {}),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

function buildAnthropic(cfg: ProviderConfig, req: ChatRequest): HttpCall {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
  if (req.json) system.push('Reply with a single JSON object only - no prose, no code fences.');

  // Anthropic wants strictly alternating turns, with tool results carried as
  // a user turn. Consecutive tool results (one per call) are merged into one.
  type Block = Record<string, unknown>;
  const messages: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  const push = (role: 'user' | 'assistant', blocks: Block[]) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of req.messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content }]);
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
    else if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
      if (!blocks.length) blocks.push({ type: 'text', text: '…' });
      push('assistant', blocks);
    }
  }

  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
  const base = trimSlash(cfg.baseUrl || 'https://api.anthropic.com');
  return {
    url: base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`,
    headers,
    body: {
      model: cfg.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(system.length ? { system: system.join('\n\n') } : {}),
      messages,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    },
  };
}

// --- reading responses -------------------------------------------------------

export function parseResponse(provider: AiProvider, data: unknown): ChatResult {
  const d = (data ?? {}) as Record<string, any>;
  switch (provider) {
    case 'OLLAMA': {
      const msg = d.message ?? {};
      return {
        content: typeof msg.content === 'string' ? msg.content : '',
        toolCalls: Array.isArray(msg.tool_calls)
          ? msg.tool_calls
              .filter((c: any) => c?.function?.name)
              .map((c: any) => ({ id: c.id || localToolCallId(), name: c.function.name, arguments: parseArgs(c.function.arguments) }))
          : [],
      };
    }
    case 'OPENAI_COMPATIBLE': {
      const msg = d.choices?.[0]?.message ?? {};
      return {
        content: typeof msg.content === 'string' ? msg.content : '',
        toolCalls: Array.isArray(msg.tool_calls)
          ? msg.tool_calls
              .filter((c: any) => c?.function?.name)
              .map((c: any) => ({ id: c.id || localToolCallId(), name: c.function.name, arguments: parseArgs(c.function.arguments) }))
          : [],
      };
    }
    case 'ANTHROPIC': {
      const blocks: any[] = Array.isArray(d.content) ? d.content : [];
      return {
        content: blocks.filter((b) => b?.type === 'text').map((b) => b.text).join(''),
        toolCalls: blocks
          .filter((b) => b?.type === 'tool_use' && b.name)
          .map((b) => ({ id: b.id || localToolCallId(), name: b.name, arguments: parseArgs(b.input) })),
      };
    }
  }
}

/**
 * Pulls one JSON object out of a model reply. Small local models wrap it in
 * code fences or a sentence often enough that a bare JSON.parse is not enough.
 * Returns null rather than throwing - callers fall back to deterministic output.
 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [text.trim(), fenced?.[1]?.trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}
