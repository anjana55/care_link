/**
 * AI features: the admin-managed provider configuration (Settings > AI), the
 * staff caregiver suggestions for a request, and the staff assistant.
 *
 * Types only - see index.ts for why nothing here may need a runtime import.
 */

/**
 * Which wire protocol the configured model speaks.
 * - OLLAMA             a local or self-hosted Ollama server (/api/chat)
 * - OPENAI_COMPATIBLE  anything exposing /v1/chat/completions (OpenAI, vLLM,
 *                      LM Studio, OpenRouter, Ollama's own /v1 endpoint...)
 * - ANTHROPIC          the Anthropic Messages API
 */
export const aiProviderValues = ['OLLAMA', 'OPENAI_COMPATIBLE', 'ANTHROPIC'] as const;
export type AiProvider = (typeof aiProviderValues)[number];

/** What the admin Settings > AI page reads. The API key itself never leaves the server. */
export interface AdminAiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyHint: string | null;
  /** Null = don't send one; the model uses its own default (some models refuse the setting). */
  temperature: number | null;
  maxTokens: number;
  timeoutMs: number;
  /** How many hard-filtered candidates the model may re-rank, at most. */
  candidatePoolSize: number;
  /** Public site: natural-language search + AI re-ranking. */
  publicSearchEnabled: boolean;
  /** Staff: "Suggest caregivers" on a request. */
  staffMatchingEnabled: boolean;
  /** Staff: the assistant chat. */
  staffAssistantEnabled: boolean;
  /** Extra instructions appended to the built-in search/matching prompt. Optional. */
  searchPrompt: string | null;
  /** Extra instructions appended to the built-in assistant prompt. Optional. */
  assistantPrompt: string | null;
  updatedAt: string | null;
}

export interface UpdateAiSettingsInput {
  enabled?: boolean;
  provider?: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  temperature?: number | null;
  maxTokens?: number;
  timeoutMs?: number;
  candidatePoolSize?: number;
  publicSearchEnabled?: boolean;
  staffMatchingEnabled?: boolean;
  staffAssistantEnabled?: boolean;
  searchPrompt?: string | null;
  assistantPrompt?: string | null;
}

export interface AiTestResult {
  ok: boolean;
  provider: AiProvider;
  model: string;
  latencyMs: number;
  /** Whether the model answered a tool call correctly - the assistant needs this. */
  toolCalling: boolean;
  message: string;
}

/** Which AI features are switched on, for staff (no configuration details). */
export interface AiFeatureStatus {
  matching: boolean;
  assistant: boolean;
}

/** One suggested caregiver for a request (staff side - internal ids and names are fine here). */
export interface StaffCaregiverSuggestion {
  caregiverId: string;
  fullName: string;
  registrationNumber: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  district: string | null;
  city: string | null;
  yearsExperience: number;
  skills: string[];
  languages: string[];
  hasVerifiedQualification: boolean;
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  /** The deterministic score from Normal Search ranking. */
  score: number;
  /** Deterministic reasons plus, when the model re-ranked, its one-line explanation. */
  reasons: string[];
  aiReason: string | null;
}

export interface StaffSuggestionsResponse {
  /** The structured criteria the suggestions were found with, as readable lines. */
  criteria: string[];
  items: StaffCaregiverSuggestion[];
  /** True when the AI re-ranked the pool; false when it fell back to deterministic order. */
  aiRanked: boolean;
  /** Set when the model could not be used, so staff know why the list is plain. */
  notice: string | null;
}

// --- staff assistant ---------------------------------------------------------

export const assistantActionStatusValues = ['PENDING', 'EXECUTED', 'REJECTED', 'FAILED'] as const;
export type AssistantActionStatus = (typeof assistantActionStatusValues)[number];

/** A change the assistant wants to make; nothing happens until staff approve it. */
export interface AssistantAction {
  id: string;
  tool: string;
  /** One line, written by the server from the arguments - never by the model. */
  summary: string;
  details: { label: string; value: string }[];
  status: AssistantActionStatus;
  /** On success: what was created/changed, for a link. */
  result: { kind: 'request' | 'booking'; id: string; reference: string | null } | null;
  error: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** A record the assistant looked at, offered as a link under its reply. */
export interface AssistantLink {
  kind: 'request' | 'booking' | 'client' | 'caregiver';
  id: string;
  label: string;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions: AssistantAction[];
  links: AssistantLink[];
  createdAt: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface AssistantConversation extends AssistantConversationSummary {
  messages: AssistantMessage[];
}
