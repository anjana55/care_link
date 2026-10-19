import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import {
  colomboToday,
  type AssistantAction,
  type AssistantConversation,
  type AssistantConversationSummary,
  type AssistantLink,
  type AssistantMessage,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../../database/database.module';
import { assistantActions, assistantConversations, assistantMessages, users } from '../../database/schema';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { BrandingSettingsService } from '../../branding/branding-settings.service';
import { AiSettingsService } from '../ai-settings.service';
import { AiProviderService, AiUnavailableError } from '../ai-provider.service';
import type { ChatMessage, ChatToolCall } from '../ai-protocol';
import { ALL_TOOLS, READ_TOOL_NAMES, WRITE_TOOL_NAMES, assistantSystemPrompt } from './assistant-tools';
import { AssistantToolbox, ToolInputError, errorMessage, type ExecutionResult } from './assistant-toolbox.service';

/** Model calls per staff message - enough to look up, cross-check and propose; bounded so a confused model cannot loop. */
const MAX_STEPS = 8;
/** How much of the transcript is replayed to the model each turn. */
const HISTORY_MESSAGES = 40;
/** A whole staff turn stops starting new model calls past this (nginx allows 180s; see deploy/proxy-locations.conf). */
const TURN_BUDGET_MS = 150_000;
/** Tool results are cut to this before being handed to the model. */
const MAX_TOOL_RESULT_CHARS = 12000;

/** The audit action each approved change is recorded under - the same names the staff pages use. */
const AUDIT: Record<string, { action: string; entityType: string }> = {
  update_request_status: { action: 'UPDATE_CARE_REQUEST_STATUS', entityType: 'CareRequest' },
  add_request_note: { action: 'ADD_CARE_REQUEST_NOTE', entityType: 'CareRequest' },
  assign_request: { action: 'ASSIGN_CARE_REQUEST', entityType: 'CareRequest' },
  set_request_caregiver: { action: 'SET_CARE_REQUEST_CAREGIVER', entityType: 'CareRequest' },
  create_request: { action: 'CREATE_PHONE_CARE_REQUEST', entityType: 'CareRequest' },
  create_booking: { action: 'CREATE_BOOKING', entityType: 'Booking' },
  confirm_booking: { action: 'CONFIRM_BOOKING', entityType: 'Booking' },
  cancel_booking: { action: 'CANCEL_BOOKING', entityType: 'Booking' },
  extend_booking: { action: 'EXTEND_BOOKING', entityType: 'Booking' },
  add_booking_note: { action: 'ADD_BOOKING_NOTE', entityType: 'Booking' },
};

type MessageRow = typeof assistantMessages.$inferSelect;
type ActionRow = typeof assistantActions.$inferSelect;

/**
 * The staff assistant: a tool-calling loop over the Requests queue and bookings.
 *
 * Each staff message runs up to MAX_STEPS model calls. Lookups run straight
 * away; changes become PENDING actions shown to the staff member as
 * Approve/Reject cards. Approving runs the change through the normal service
 * as the approver - same validation, notifications and audit trail as doing
 * it on the page - and the outcome is fed back to the model on the next turn.
 *
 * Conversations are private to the staff member who started them.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: AiSettingsService,
    private readonly provider: AiProviderService,
    private readonly toolbox: AssistantToolbox,
    private readonly audit: AuditService,
    private readonly branding: BrandingSettingsService,
  ) {}

  private async requireEnabled() {
    const s = await this.settings.forFeature('staffAssistant');
    if (!s) throw new ServiceUnavailableException('The assistant is switched off - an admin can turn it on in Settings > AI');
    return s;
  }

  private async ownConversation(id: string, user: AuthenticatedUser) {
    const [row] = await this.db.select().from(assistantConversations).where(eq(assistantConversations.id, id)).limit(1);
    if (!row || row.userId !== user.userId) throw new NotFoundException('Conversation not found');
    return row;
  }

  // --- conversations ---------------------------------------------------------------

  async list(user: AuthenticatedUser): Promise<AssistantConversationSummary[]> {
    const rows = await this.db
      .select()
      .from(assistantConversations)
      .where(eq(assistantConversations.userId, user.userId))
      .orderBy(desc(assistantConversations.updatedAt))
      .limit(50);
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: new Date(r.updatedAt).toISOString() }));
  }

  async get(id: string, user: AuthenticatedUser): Promise<AssistantConversation> {
    const convo = await this.ownConversation(id, user);
    const [messages, actions] = await Promise.all([
      this.db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, id)).orderBy(asc(assistantMessages.createdAt)),
      this.db.select().from(assistantActions).where(eq(assistantActions.conversationId, id)).orderBy(asc(assistantActions.createdAt)),
    ]);
    const deciders = await this.userNames(actions.map((a) => a.decidedByUserId));
    const byMessage = new Map<string, AssistantAction[]>();
    for (const a of actions) byMessage.set(a.messageId, [...(byMessage.get(a.messageId) ?? []), this.toAction(a, deciders)]);

    // Staff see their own messages and the assistant's replies; the
    // intermediate tool-calling steps and tool results stay internal.
    const visible: AssistantMessage[] = messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.toolCalls))
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        actions: byMessage.get(m.id) ?? [],
        links: (m.links as AssistantLink[] | null) ?? [],
        createdAt: new Date(m.createdAt).toISOString(),
      }));
    return { id: convo.id, title: convo.title, updatedAt: new Date(convo.updatedAt).toISOString(), messages: visible };
  }

  async create(user: AuthenticatedUser): Promise<AssistantConversationSummary> {
    await this.requireEnabled();
    const id = uuid();
    const now = new Date();
    await this.db.insert(assistantConversations).values({ id, userId: user.userId, title: 'New conversation', createdAt: now, updatedAt: now });
    return { id, title: 'New conversation', updatedAt: now.toISOString() };
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.ownConversation(id, user);
    await this.db.transaction(async (tx) => {
      await tx.delete(assistantActions).where(eq(assistantActions.conversationId, id));
      await tx.delete(assistantMessages).where(eq(assistantMessages.conversationId, id));
      await tx.delete(assistantConversations).where(eq(assistantConversations.id, id));
    });
    return { id, deleted: true };
  }

  // --- a turn ----------------------------------------------------------------------

  async send(conversationId: string, content: string, user: AuthenticatedUser): Promise<AssistantConversation> {
    const settings = await this.requireEnabled();
    const convo = await this.ownConversation(conversationId, user);

    const userMessageId = uuid();
    await this.db.insert(assistantMessages).values({ id: userMessageId, conversationId, role: 'user', content, createdAt: new Date() });
    if (convo.title === 'New conversation') {
      await this.db
        .update(assistantConversations)
        .set({ title: content.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Conversation' })
        .where(eq(assistantConversations.id, conversationId));
    }

    const [me] = await this.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, user.userId)).limit(1);
    const history = await this.history(conversationId);
    const system = assistantSystemPrompt({
      staffName: me?.fullName ?? 'a staff member',
      role: user.role,
      today: colomboToday(),
      brand: await this.branding.companyName(),
      extra: settings.assistantPrompt,
      actionUpdates: await this.actionUpdates(conversationId),
    });

    // The reply staff will see. Actions proposed during this turn hang off it.
    const replyId = uuid();
    const transcript: ChatMessage[] = [{ role: 'system', content: system }, ...history];
    const links = new Map<string, AssistantLink>();
    let finalText = '';

    const deadline = Date.now() + TURN_BUDGET_MS;
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (step > 0 && Date.now() + settings.timeoutMs > deadline) {
          finalText = 'I ran out of time before finishing this. Please ask me to continue, or narrow the question.';
          break;
        }
        const result = await this.provider.chat(settings, { messages: transcript, tools: ALL_TOOLS });
        if (!result.toolCalls.length) {
          finalText = result.content.trim();
          break;
        }

        // Persist the tool-calling step so the next turn replays it faithfully.
        const stepContent = result.content ?? '';
        transcript.push({ role: 'assistant', content: stepContent, toolCalls: result.toolCalls });
        await this.db.insert(assistantMessages).values({
          id: uuid(),
          conversationId,
          role: 'assistant',
          content: stepContent,
          toolCalls: result.toolCalls,
          createdAt: new Date(),
        });

        for (const call of result.toolCalls) {
          const output = await this.runTool(call, user, conversationId, replyId, links);
          transcript.push({ role: 'tool', content: output, toolCallId: call.id, name: call.name });
          await this.db.insert(assistantMessages).values({
            id: uuid(),
            conversationId,
            role: 'tool',
            content: output,
            toolCallId: call.id,
            toolName: call.name,
            createdAt: new Date(),
          });
        }
        if (step === MAX_STEPS - 1) {
          finalText = 'I had to stop there - this needed more steps than I am allowed in one go. Please tell me what to focus on next.';
        }
      }
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      finalText = `Sorry - I could not reach the AI model just now (${err.message.toLowerCase()}). Please try again in a moment.`;
    }

    const proposed = await this.db.select({ id: assistantActions.id }).from(assistantActions).where(eq(assistantActions.messageId, replyId));
    if (!finalText) {
      finalText = proposed.length
        ? 'I have prepared the change below - please review it and approve or reject.'
        : 'Sorry, I did not get an answer from the model. Please try rephrasing.';
    }

    await this.db.insert(assistantMessages).values({
      id: replyId,
      conversationId,
      role: 'assistant',
      content: finalText,
      links: [...links.values()].slice(0, 8),
      createdAt: new Date(),
    });
    await this.db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, conversationId));
    return this.get(conversationId, user);
  }

  /** Runs one tool call; always returns text for the model, never throws for bad input. */
  private async runTool(call: ChatToolCall, user: AuthenticatedUser, conversationId: string, replyId: string, links: Map<string, AssistantLink>): Promise<string> {
    try {
      if (READ_TOOL_NAMES.has(call.name)) {
        const { data, links: found } = await this.toolbox.read(call.name, call.arguments, user);
        for (const l of found) links.set(`${l.kind}:${l.id}`, l);
        const text = JSON.stringify(data);
        return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}... (truncated - narrow the search)` : text;
      }
      if (WRITE_TOOL_NAMES.has(call.name)) {
        const proposal = await this.toolbox.propose(call.name, call.arguments, user);
        const id = uuid();
        await this.db.insert(assistantActions).values({
          id,
          conversationId,
          messageId: replyId,
          tool: call.name,
          args: proposal.args,
          summary: proposal.summary.slice(0, 500),
          details: proposal.details,
          status: 'PENDING',
        });
        return JSON.stringify({
          status: 'PROPOSED_AWAITING_APPROVAL',
          summary: proposal.summary,
          note: 'Nothing has changed yet. The staff member sees this as a card to approve or reject. Do not say it is done.',
        });
      }
      return JSON.stringify({ error: `There is no tool called ${call.name}` });
    } catch (err) {
      if (err instanceof ToolInputError) return JSON.stringify({ error: err.message });
      const message = errorMessage(err);
      if (message === 'Something went wrong') this.logger.error(`Assistant tool ${call.name} failed`, err as Error);
      return JSON.stringify({ error: message });
    }
  }

  /**
   * The replayed transcript. Cut at a staff message so a tool result is never
   * replayed without the tool call it answers (providers reject that).
   */
  private async history(conversationId: string): Promise<ChatMessage[]> {
    const rows = (
      await this.db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conversationId))
        .orderBy(desc(assistantMessages.createdAt))
        .limit(HISTORY_MESSAGES)
    ).reverse();
    const firstUser = rows.findIndex((r) => r.role === 'user');
    return rows.slice(Math.max(firstUser, 0)).map((r: MessageRow): ChatMessage => {
      if (r.role === 'tool') return { role: 'tool', content: r.content, toolCallId: r.toolCallId ?? '', name: r.toolName ?? '' };
      if (r.role === 'assistant') return { role: 'assistant', content: r.content, ...(r.toolCalls ? { toolCalls: r.toolCalls as ChatToolCall[] } : {}) };
      return { role: 'user', content: r.content };
    });
  }

  /** What became of the changes proposed earlier, so the model does not repeat or misreport them. */
  private async actionUpdates(conversationId: string): Promise<string[]> {
    const rows = await this.db.select().from(assistantActions).where(eq(assistantActions.conversationId, conversationId)).orderBy(asc(assistantActions.createdAt));
    return rows.slice(-15).map((a) => {
      const state =
        a.status === 'EXECUTED'
          ? `APPROVED and done${a.result ? ` (${(a.result as ExecutionResult).reference ?? ''})` : ''}`
          : a.status === 'FAILED'
            ? `approved but FAILED: ${a.error}`
            : a.status;
      return `- ${a.summary}: ${state}`;
    });
  }

  // --- approvals ---------------------------------------------------------------------

  private async ownAction(actionId: string, user: AuthenticatedUser) {
    const [row] = await this.db.select().from(assistantActions).where(eq(assistantActions.id, actionId)).limit(1);
    if (!row) throw new NotFoundException('Action not found');
    await this.ownConversation(row.conversationId, user);
    return row;
  }

  async approve(actionId: string, user: AuthenticatedUser, ip: string | null): Promise<AssistantAction> {
    const action = await this.ownAction(actionId, user);
    // Claim it first: a double-click or a second tab must not run it twice.
    const claimed = await this.db
      .update(assistantActions)
      .set({ status: 'EXECUTED', decidedByUserId: user.userId, decidedAt: new Date() })
      .where(and(eq(assistantActions.id, actionId), eq(assistantActions.status, 'PENDING')));
    if (!affected(claimed)) throw new ConflictException('This change has already been decided');

    try {
      const result = await this.toolbox.execute(action.tool, action.args as Record<string, unknown>, user);
      await this.db.update(assistantActions).set({ result }).where(eq(assistantActions.id, actionId));
      const audit = AUDIT[action.tool];
      if (audit) {
        void this.audit.record({
          userId: user.userId,
          action: audit.action,
          entityType: audit.entityType,
          entityId: result.id,
          metadata: { via: 'assistant', assistantActionId: actionId },
          ipAddress: ip,
        });
      }
    } catch (err) {
      await this.db
        .update(assistantActions)
        .set({ status: 'FAILED', error: errorMessage(err).slice(0, 500) })
        .where(eq(assistantActions.id, actionId));
      if (errorMessage(err) === 'Something went wrong') this.logger.error(`Assistant action ${action.tool} failed`, err as Error);
    }
    return this.actionById(actionId);
  }

  async reject(actionId: string, user: AuthenticatedUser): Promise<AssistantAction> {
    await this.ownAction(actionId, user);
    const res = await this.db
      .update(assistantActions)
      .set({ status: 'REJECTED', decidedByUserId: user.userId, decidedAt: new Date() })
      .where(and(eq(assistantActions.id, actionId), eq(assistantActions.status, 'PENDING')));
    if (!affected(res)) throw new ConflictException('This change has already been decided');
    return this.actionById(actionId);
  }

  private async actionById(id: string): Promise<AssistantAction> {
    const [row] = await this.db.select().from(assistantActions).where(eq(assistantActions.id, id)).limit(1);
    const names = await this.userNames([row.decidedByUserId]);
    return this.toAction(row, names);
  }

  private toAction(a: ActionRow, names: Map<string, string>): AssistantAction {
    return {
      id: a.id,
      tool: a.tool,
      summary: a.summary,
      details: (a.details as AssistantAction['details'] | null) ?? [],
      status: a.status,
      result: (a.result as AssistantAction['result']) ?? null,
      error: a.error,
      decidedBy: a.decidedByUserId ? (names.get(a.decidedByUserId) ?? null) : null,
      decidedAt: a.decidedAt ? new Date(a.decidedAt).toISOString() : null,
    };
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

/** mysql2 reports affected rows on the result header; drizzle passes it through as [header, ...]. */
function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}
