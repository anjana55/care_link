'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Maximize2, Plus, Send, X } from 'lucide-react';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useAiStatus, useAssistantMutations, useConversation } from '@/lib/hooks/use-ai';
import { Button } from '@/components/ui/button';
import { MessageView } from './assistant-message';
import { cn } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_KEY = 'assistant.floating.conversation';

type RecordKind = 'request' | 'booking' | 'caregiver' | 'client';
const RECORD_ROUTES: Record<string, RecordKind> = { requests: 'request', bookings: 'booking', caregivers: 'caregiver', clients: 'client' };

/** The record page they are on, if any - what "this" means. The server works out the rest from the path. */
function recordOn(pathname: string | null): RecordKind | null {
  const parts = (pathname ?? '').split('/').filter(Boolean);
  return parts.length === 2 && UUID.test(parts[1]) ? (RECORD_ROUTES[parts[0]] ?? null) : null;
}

const GENERAL_STARTERS = ['assistant.starters.newRequests', 'assistant.starters.unmatched', 'assistant.starters.today', 'assistant.starters.mine'];
const RECORD_STARTERS: Record<RecordKind, string[]> = {
  request: ['assistant.floating.starters.summariseRequest', 'assistant.floating.starters.suggestCaregivers', 'assistant.floating.starters.assignToMe'],
  booking: ['assistant.floating.starters.summariseBooking', 'assistant.floating.starters.nextShifts'],
  caregiver: ['assistant.floating.starters.caregiverBookings', 'assistant.floating.starters.caregiverRequests'],
  client: ['assistant.floating.starters.clientBookings', 'assistant.floating.starters.clientRequests'],
};

const readStored = () => {
  try {
    return sessionStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
};
const writeStored = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORE_KEY, id);
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Private mode and the like: the conversation just doesn't survive a reload.
  }
};

/**
 * The assistant, a click away on every staff page: a round button bottom-right
 * that opens a chat panel. Each message carries the page it was sent from, so
 * "this booking" or "assign it to me" works without typing a reference.
 *
 * Shown to the roles the Assistant page is for (ADMIN, STAFF), only while the
 * assistant is switched on in Settings > AI, and not on the Assistant page
 * itself. Changes still come back as cards to approve, exactly as there.
 */
export function AssistantLauncher() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = usePathname();
  const canUse = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: status } = useAiStatus(canUse);
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const { data: conversation, isError: conversationGone } = useConversation(conversationId);
  const { create, send, decide } = useAssistantMutations();
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  // The same conversation across pages and reloads in this tab.
  useEffect(() => setConversationId(readStored()), []);
  // Deleted on the Assistant page meanwhile: start afresh rather than show an error.
  useEffect(() => {
    if (conversationGone) {
      setConversationId(null);
      writeStored(null);
    }
  }, [conversationGone]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, conversation?.messages.length, pendingText]);

  if (!canUse || !status?.assistant || pathname?.startsWith('/assistant')) return null;

  const close = () => {
    setOpen(false);
    launcherRef.current?.focus();
  };

  async function submit(text: string) {
    const content = text.trim();
    if (!content || send.isPending) return;
    let id = conversationId;
    if (!id) {
      id = (await create.mutateAsync()).id;
      setConversationId(id);
      writeStored(id);
    }
    setDraft('');
    setPendingText(content);
    send.mutate(
      { id, content, path: pathname ?? undefined },
      {
        onSettled: () => setPendingText(null),
        onError: () => setDraft(content),
      },
    );
  }

  const startOver = () => {
    setConversationId(null);
    writeStored(null);
    setDraft('');
    send.reset();
    inputRef.current?.focus();
  };

  const record = recordOn(pathname);
  const messages = conversation?.messages ?? [];
  const empty = !pendingText && messages.length === 0;
  const starters = record ? RECORD_STARTERS[record] : GENERAL_STARTERS;

  return (
    <div className="print:hidden">
      {open && (
        <section
          role="dialog"
          aria-label={t('assistant.title')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
          className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(640px,calc(100vh-8rem))] sm:w-[420px] sm:rounded-xl sm:border sm:border-border sm:shadow-2xl"
        >
          <header className="flex items-start gap-3 border-b border-border px-4 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-light text-accent">
              <Bot size={17} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-ink">{t('assistant.title')}</h2>
              <p className="truncate text-xs text-ink/55">{record ? t(`assistant.floating.context.${record}`) : t('assistant.floating.context.page')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button onClick={startOver} title={t('assistant.new')} aria-label={t('assistant.new')} className="flex h-8 w-8 items-center justify-center rounded text-ink/55 hover:bg-paper hover:text-ink">
                <Plus size={16} />
              </button>
              <Link
                href="/assistant"
                onClick={() => setOpen(false)}
                title={t('assistant.floating.openFull')}
                aria-label={t('assistant.floating.openFull')}
                className="flex h-8 w-8 items-center justify-center rounded text-ink/55 hover:bg-paper hover:text-ink"
              >
                <Maximize2 size={15} />
              </Link>
              <button onClick={close} title={t('assistant.floating.close')} aria-label={t('assistant.floating.close')} className="flex h-8 w-8 items-center justify-center rounded text-ink/55 hover:bg-paper hover:text-ink">
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {empty ? (
              <div className="pt-2">
                <p className="text-sm text-ink/70">{t('assistant.intro')}</p>
                <div className="mt-4 space-y-2">
                  {starters.map((key) => (
                    <button key={key} onClick={() => void submit(t(key))} className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-ink/80 hover:border-brand hover:bg-paper">
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <MessageView
                    key={m.id}
                    message={m}
                    onDecide={(actionId, approve) => conversation && decide.mutate({ actionId, approve, conversationId: conversation.id })}
                    deciding={decide.isPending ? decide.variables?.actionId : undefined}
                  />
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
            className="border-t border-border p-3"
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
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
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
                placeholder={t('assistant.floating.placeholder')}
                aria-label={t('assistant.floating.placeholder')}
                className="min-h-[2.75rem] flex-1 resize-none rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <Button type="submit" disabled={!draft.trim() || send.isPending} aria-label={t('assistant.send')}>
                <Send size={16} aria-hidden />
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-ink/40">{t('assistant.disclaimer')}</p>
          </form>
        </section>
      )}

      <button
        ref={launcherRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label={open ? t('assistant.floating.close') : t('assistant.floating.open')}
        title={open ? undefined : t('assistant.floating.open')}
        className={cn(
          'fixed bottom-6 right-6 z-40 h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
          // On a phone the open panel fills the screen and has its own close button.
          open ? 'hidden sm:flex' : 'flex',
        )}
      >
        {open ? <X size={22} aria-hidden /> : <Bot size={24} aria-hidden />}
      </button>
    </div>
  );
}
