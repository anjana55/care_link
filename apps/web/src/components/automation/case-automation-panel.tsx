'use client';

import { useState } from 'react';
import { Bot, UserRound } from 'lucide-react';
import type { AutomationCaseType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { fmtDateTime } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';
import { useCaseAutomation, useCaseDriverSwitch } from '@/lib/hooks/use-automation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label } from '@/components/ui/input';

const OUTCOME_STYLES = { SHADOW: 'bg-ink/10 text-ink/70', PROPOSED: 'bg-accent-light text-accent', EXECUTED: 'bg-brand-light text-brand-dark' } as const;

/**
 * Who is driving this case - an agent or staff - with "Take over" / "Hand
 * back", the agent's handover note and what it decided.
 *
 * Renders nothing at all unless an agent for this kind of record is switched
 * on, or the case already has automation history. With every dial at Manual
 * the page looks exactly as it did before.
 */
export function CaseAutomationPanel({ caseType, caseId, className }: { caseType: AutomationCaseType; caseId: string; className?: string }) {
  const { t, locale } = useTranslation();
  const { data } = useCaseAutomation(caseType, caseId);
  const switchDriver = useCaseDriverSwitch(caseType, caseId);
  const [confirm, setConfirm] = useState<'STAFF' | 'AGENT' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!data) return null;
  const staffDriving = data.driver === 'STAFF';
  if (!data.agentActive && !staffDriving && !data.handoverNote && data.decisions.length === 0) return null;

  const when = (iso: string) => fmtDateTime(iso, locale);
  const close = () => (setConfirm(null), setReason(''), setError(null));
  const run = () =>
    switchDriver.mutate(confirm === 'STAFF' ? { to: 'STAFF', reason: reason.trim() || undefined } : { to: 'AGENT' }, {
      onSuccess: close,
      onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('automation.case.error')),
    });

  const agentDriving = data.agentActive && !staffDriving;
  const Icon = agentDriving ? Bot : UserRound;
  const note = data.handoverNote;

  return (
    <section
      aria-label={t('automation.title')}
      className={cn('mb-6 rounded-lg border px-4 py-3 print:hidden', agentDriving ? 'border-brand/40 bg-brand-light/40' : 'border-border bg-white', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon size={18} className={cn('mt-0.5 shrink-0', agentDriving ? 'text-brand-dark' : 'text-ink/60')} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{agentDriving ? t('automation.case.agentHandling') : t('automation.case.staffHandling')}</p>
            <p className="text-xs text-ink/60">
              {staffDriving && data.takenOverAt
                ? data.takeoverSource === 'PERSON'
                  ? t('automation.case.takenOverByPerson', { when: when(data.takenOverAt) })
                  : t('automation.case.takenOverBy', { name: data.takenOverByName ?? '-', when: when(data.takenOverAt) })
                : agentDriving && data.mode !== 'MANUAL'
                  ? t(`automation.case.modeHint.${data.mode}`)
                  : t('automation.case.agentOff')}
            </p>
            {staffDriving && data.takeoverReason && <p className="text-xs text-ink/60">{t('automation.case.reasonGiven', { reason: data.takeoverReason })}</p>}
          </div>
        </div>
        {staffDriving ? (
          <Button size="sm" variant="secondary" onClick={() => setConfirm('AGENT')}>
            {t('automation.case.handBack')}
          </Button>
        ) : (
          data.agentActive && (
            <Button size="sm" onClick={() => setConfirm('STAFF')}>
              {t('automation.case.takeOver')}
            </Button>
          )
        )}
      </div>

      {note && (
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('automation.case.note.title')}</h3>
          <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink/60">{t('automation.case.note.done')}</dt>
            <dd className="text-ink">{note.done}</dd>
            <dt className="text-ink/60">{t('automation.case.note.waiting')}</dt>
            <dd className="text-ink">{note.waiting}</dd>
            <dt className="text-ink/60">{t('automation.case.note.next')}</dt>
            <dd className="text-ink">{note.next}</dd>
          </dl>
          {data.handoverNoteAt && <p className="mt-1 text-xs text-ink/50">{t('automation.case.note.at', { when: when(data.handoverNoteAt) })}</p>}
        </div>
      )}

      {data.decisions.length > 0 && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-dark">
            {t('automation.case.timeline')} ({data.decisions.length})
          </summary>
          <ol className="mt-2 space-y-2">
            {data.decisions.map((d) => (
              <li key={d.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', OUTCOME_STYLES[d.outcome])}>{t(`automation.case.outcomes.${d.outcome}`)}</span>
                  <span className="font-medium text-ink">{d.actionLabel}</span>
                  <span className="text-xs tabular-nums text-ink/50">{when(d.createdAt)}</span>
                </div>
                <p className="text-ink/70">{d.reason}</p>
                {d.staffVerdict && (
                  <p className={cn('text-xs', d.staffVerdict === 'AGREED' ? 'text-ink/60' : 'text-danger')}>
                    {t(`automation.case.verdicts.${d.staffVerdict}`)}
                    {d.staffNote && ` - ${d.staffNote}`}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}

      {confirm && (
        <ConfirmDialog
          title={t(confirm === 'STAFF' ? 'automation.case.takeOverTitle' : 'automation.case.handBackTitle')}
          message={t(confirm === 'STAFF' ? 'automation.case.takeOverMessage' : 'automation.case.handBackMessage')}
          confirmLabel={t(confirm === 'STAFF' ? 'automation.case.takeOver' : 'automation.case.handBack')}
          pending={switchDriver.isPending}
          error={error}
          onConfirm={run}
          onCancel={close}
        >
          {confirm === 'STAFF' && (
            <div className="mb-4">
              <Label htmlFor="takeover-reason">{t('automation.case.reason')}</Label>
              <Input id="takeover-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
