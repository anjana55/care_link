'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, Check, ExternalLink, Plus, Send, Trash2, X } from 'lucide-react';
import type { AssistantAction, AssistantLink, AssistantMessage } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useAiStatus, useAssistantMutations, useConversation, useConversations } from '@/lib/hooks/use-ai';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const LINK_PATH: Record<AssistantLink['kind'], string> = {
  request: '/requests',
  booking: '/bookings',
  client: '/clients',
  caregiver: '/caregivers',
};

const STARTERS = ['assistant.starters.newRequests', 'assistant.starters.unmatched', 'assistant.starters.today', 'assistant.starters.mine'];

/**
 * The staff assistant. It looks things up on its own; anything that would
 * change a request or a booking comes back as a card the staff member approves
 * or rejects - nothing is changed until they do.
 */
export default function AssistantPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const canUse = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: status, isLoading: statusLoading } = useAiStatus(canUse);
  const { data: conversations } = useConversations();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: conversation } = useConversation(activeId);
  const { create, send, remove, decide } = useAssistantMutations();
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading) return;
    if (user && !canUse) router.replace('/dashboard');
  }, [loading, user, canUse, router]);

  // Open the latest conversation when arriving without one.
  useEffect(() => {
    if (!activeId && conversations?.length) setActiveId(conversations[0].id);
  }, [activeId, conversations]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages.length, pendingText]);

  if (loading || !user || !canUse || statusLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  if (!status?.assistant) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <Bot className="mx-auto mb-3 text-ink/30" size={36} aria-hidden />
        <h1 className="text-lg font-semibold text-ink">{t('assistant.title')}</h1>
        <p className="mt-2 text-sm text-ink/60">{t('assistant.off')}</p>
        {user.role === 'ADMIN' && (
          <Link href="/settings/ai" className="mt-4 inline-block text-sm text-brand-dark hover:underline">
            {t('assistant.openSettings')}
          </Link>
        )}
      </div>
    );
  }

  async function submit(text: string) {
    const content = text.trim();
    if (!content || send.isPending) return;
    let id = activeId;
    if (!id) {
      const created = await create.mutateAsync();
      id = created.id;
      setActiveId(id);
    }
    setDraft('');
    setPendingText(content);
    send.mutate(
      { id, content },
      {
        onSettled: () => setPendingText(null),
        onError: () => setDraft(content),
      },
    );
  }

  async function newConversation() {
    const created = await create.mutateAsync();
    setActiveId(created.id);
    setDraft('');
  }

  const messages = conversation?.messages ?? [];
  const empty = !pendingText && messages.length === 0;

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[32rem] gap-4">
      {/* Conversation list - desktop */}
      <aside className="hidden w-64 shrink-0 flex-col lg:flex">
        <Button onClick={newConversation} disabled={create.isPending} className="mb-3 w-full">
          <Plus size={16} aria-hidden />
          {t('assistant.new')}
        </Button>
        <nav aria-label={t('assistant.conversations')} className="flex-1 space-y-0.5 overflow-y-auto">
          {(conversations ?? []).map((c) => (
            <div key={c.id} className={cn('group flex items-center rounded', c.id === activeId ? 'bg-brand-light' : 'hover:bg-paper')}>
              <button
                onClick={() => setActiveId(c.id)}
                aria-current={c.id === activeId ? 'page' : undefined}
                className={cn('min-w-0 flex-1 truncate px-3 py-2 text-left text-sm', c.id === activeId ? 'font-medium text-brand-dark' : 'text-ink/70')}
              >
                {c.title}
              </button>
              <button
                onClick={() => {
                  if (!window.confirm(t('assistant.deleteConfirm'))) return;
                  remove.mutate(c.id);
                  if (c.id === activeId) setActiveId(null);
                }}
                aria-label={t('assistant.delete', { title: c.title })}
                className="mr-1 hidden h-7 w-7 items-center justify-center rounded text-ink/40 hover:text-danger group-hover:flex"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-white">
        {/* Conversation picker - mobile */}
        <div className="flex items-center gap-2 border-b border-border p-3 lg:hidden">
          <Select aria-label={t('assistant.conversations')} value={activeId ?? ''} onChange={(e) => setActiveId(e.target.value || null)} className="flex-1">
            <option value="">{t('assistant.new')}</option>
            {(conversations ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="secondary" onClick={newConversation} aria-label={t('assistant.new')}>
            <Plus size={16} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {empty ? (
            <div className="mx-auto mt-8 max-w-lg text-center">
              <Bot className="mx-auto mb-3 text-accent" size={32} aria-hidden />
              <h1 className="text-lg font-semibold text-ink">{t('assistant.title')}</h1>
              <p className="mt-1 text-sm text-ink/60">{t('assistant.intro')}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {STARTERS.map((key) => (
                  <button key={key} onClick={() => submit(t(key))} className="rounded-lg border border-border px-3 py-2 text-left text-sm text-ink/80 hover:border-brand hover:bg-paper">
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <MessageView key={m.id} message={m} onDecide={(actionId, approve) => conversation && decide.mutate({ actionId, approve, conversationId: conversation.id })} deciding={decide.isPending ? decide.variables?.actionId : undefined} />
              ))}
              {pendingText && (
                <>
                  <MessageView message={{ id: 'pending', role: 'user', content: pendingText, actions: [], links: [], createdAt: new Date().toISOString() }} />
                  <p className="text-sm italic text-ink/50">{t('assistant.thinking')}</p>
                </>
              )}
              {decide.isError && (
                <p role="alert" className="text-sm text-danger">
                  {decide.error instanceof ApiError ? decide.error.message : t('assistant.decideFailed')}
                </p>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <form
          className="border-t border-border p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          {send.isError && (
            <p role="alert" className="mb-2 text-sm text-danger">
              {send.error instanceof ApiError ? send.error.message : t('assistant.sendFailed')}
            </p>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit(draft);
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={t('assistant.placeholder')}
              aria-label={t('assistant.placeholder')}
              className="min-h-[2.75rem] flex-1 resize-none rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <Button type="submit" disabled={!draft.trim() || send.isPending} aria-label={t('assistant.send')}>
              <Send size={16} aria-hidden />
            </Button>
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl text-xs text-ink/40">{t('assistant.disclaimer')}</p>
        </form>
      </section>
    </div>
  );
}

function MessageView({
  message,
  onDecide,
  deciding,
}: {
  message: AssistantMessage;
  onDecide?: (actionId: string, approve: boolean) => void;
  deciding?: string;
}) {
  const { t } = useTranslation();
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-white">{message.content}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
        <Bot size={15} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{message.content}</p>
        {message.actions.map((a) => (
          <ActionCard key={a.id} action={a} onDecide={onDecide} busy={deciding === a.id} />
        ))}
        {message.links.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.links.map((l) => (
              <Link
                key={`${l.kind}:${l.id}`}
                href={`${LINK_PATH[l.kind]}/${l.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-ink/70 hover:border-brand hover:text-brand-dark"
              >
                {l.label}
                <ExternalLink size={11} aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionCard({ action, onDecide, busy }: { action: AssistantAction; onDecide?: (id: string, approve: boolean) => void; busy: boolean }) {
  const { t } = useTranslation();
  const tone =
    action.status === 'PENDING'
      ? 'border-accent/40 bg-accent-light/40'
      : action.status === 'EXECUTED'
        ? 'border-brand/30 bg-brand-light/40'
        : action.status === 'FAILED'
          ? 'border-danger/30 bg-danger/5'
          : 'border-border bg-paper';
  return (
    <Card className={cn('border', tone)}>
      <CardContent className="py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t(`assistant.action.${action.status}`)}</p>
        <p className="mt-0.5 text-sm font-medium text-ink">{action.summary}</p>
        {action.details.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {action.details.map((d) => (
              <div key={d.label} className="contents">
                <dt className="text-ink/50">{d.label}</dt>
                <dd className="whitespace-pre-wrap text-ink/80">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {action.status === 'PENDING' && onDecide && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => onDecide(action.id, true)}>
              <Check size={14} aria-hidden />
              {t('assistant.approve')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(action.id, false)}>
              <X size={14} aria-hidden />
              {t('assistant.reject')}
            </Button>
          </div>
        )}
        {action.status === 'FAILED' && action.error && <p className="mt-2 text-xs text-danger">{action.error}</p>}
        {action.status !== 'PENDING' && action.decidedBy && (
          <p className="mt-2 text-xs text-ink/50">
            {t(action.status === 'REJECTED' ? 'assistant.rejectedBy' : 'assistant.approvedBy', { name: action.decidedBy })}
            {action.result && (
              <>
                {' · '}
                <Link href={`${LINK_PATH[action.result.kind]}/${action.result.id}`} className="text-brand-dark hover:underline">
                  {t('assistant.open', { reference: action.result.reference ?? '' })}
                </Link>
              </>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
