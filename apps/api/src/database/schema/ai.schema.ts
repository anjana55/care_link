import { mysqlTable, varchar, datetime, mysqlEnum, boolean, int, decimal, text, json, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const aiProviderEnum = ['OLLAMA', 'OPENAI_COMPATIBLE', 'ANTHROPIC'] as const;

/**
 * Admin-managed AI configuration (Settings > AI) - a single row, id 'default',
 * like the email, WhatsApp, billing and branding settings.
 *
 * Off by default: a deployment that never opens the page has exactly the
 * deterministic Normal Search it shipped with, and no feature ever calls a
 * model it has not been told about. The API key is AES-GCM encrypted at rest
 * (secret-box.util) because it has to be sent on, so it cannot be hashed.
 */
export const aiSettings = mysqlTable('ai_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  provider: mysqlEnum('provider', aiProviderEnum).notNull().default('OLLAMA'),
  baseUrl: varchar('base_url', { length: 255 }).notNull().default('http://localhost:11434'),
  model: varchar('model', { length: 120 }).notNull().default('qwen2.5:7b-instruct'),
  apiKeyEncrypted: text('api_key_encrypted'),
  // Null = not sent, the model's own default. Some models (newer Anthropic and
  // OpenAI reasoning models) refuse the parameter outright.
  temperature: decimal('temperature', { precision: 3, scale: 2 }).default('0.20'),
  maxTokens: int('max_tokens').notNull().default(1024),
  timeoutMs: int('timeout_ms').notNull().default(30000),
  candidatePoolSize: int('candidate_pool_size').notNull().default(20),

  publicSearchEnabled: boolean('public_search_enabled').notNull().default(true),
  staffMatchingEnabled: boolean('staff_matching_enabled').notNull().default(true),
  staffAssistantEnabled: boolean('staff_assistant_enabled').notNull().default(true),

  searchPrompt: text('search_prompt'),
  assistantPrompt: text('assistant_prompt'),

  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** One staff member's chat with the assistant. Private to that user. */
export const assistantConversations = mysqlTable(
  'assistant_conversations',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    userIdx: index('assistant_conversations_user_idx').on(table.userId, table.updatedAt),
  }),
);

export const assistantMessageRoleEnum = ['user', 'assistant', 'tool'] as const;

/**
 * The transcript, in the provider-neutral shape the assistant replays to the
 * model each turn. `tool` rows hold what a lookup returned so the model keeps
 * the context; staff never see them directly. `links` are records the turn
 * looked at, shown under the reply.
 */
export const assistantMessages = mysqlTable(
  'assistant_messages',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', assistantMessageRoleEnum).notNull(),
    content: text('content').notNull(),
    toolCalls: json('tool_calls'),
    toolCallId: varchar('tool_call_id', { length: 64 }),
    toolName: varchar('tool_name', { length: 64 }),
    links: json('links'),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    conversationIdx: index('assistant_messages_conversation_idx').on(table.conversationId, table.createdAt),
  }),
);

export const assistantActionStatusEnum = ['PENDING', 'EXECUTED', 'REJECTED', 'FAILED'] as const;

/**
 * A change the assistant proposed. Nothing is written to requests or bookings
 * until a staff member approves it, and then it runs through the same service
 * methods (and validations, notifications and audit entries) the staff pages use,
 * as that staff member.
 */
export const assistantActions = mysqlTable(
  'assistant_actions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    conversationId: varchar('conversation_id', { length: 36 }).notNull(),
    messageId: varchar('message_id', { length: 36 }).notNull(),
    tool: varchar('tool', { length: 64 }).notNull(),
    args: json('args').notNull(),
    summary: varchar('summary', { length: 500 }).notNull(),
    details: json('details'),
    status: mysqlEnum('status', assistantActionStatusEnum).notNull().default('PENDING'),
    result: json('result'),
    error: varchar('error', { length: 500 }),
    decidedByUserId: varchar('decided_by_user_id', { length: 36 }),
    decidedAt: datetime('decided_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    conversationIdx: index('assistant_actions_conversation_idx').on(table.conversationId),
    messageIdx: index('assistant_actions_message_idx').on(table.messageId),
  }),
);
