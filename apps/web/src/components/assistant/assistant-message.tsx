'use client';

import Link from 'next/link';
import { Bot, Check, ExternalLink, X } from 'lucide-react';
import type { AssistantAction, AssistantLink, AssistantMessage } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Shared by the Assistant page and the floating assistant. */
export const LINK_PATH: Record<AssistantLink['kind'], string> = {
  request: '/requests',
  booking: '/bookings',
  client: '/clients',
  caregiver: '/caregivers',
};

export function MessageView({
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

export function ActionCard({ action, onDecide, busy }: { action: AssistantAction; onDecide?: (id: string, approve: boolean) => void; busy: boolean }) {
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
