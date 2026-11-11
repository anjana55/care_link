'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AgentDecisionView } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useDecideProposal } from '@/lib/hooks/use-automation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label } from '@/components/ui/input';

/**
 * Approve / Decline for one proposal, wherever it is shown. Approving carries
 * the step out at once; if that fails the reason stays under the buttons and
 * the proposal stays waiting.
 */
export function ProposalActions({ decision }: { decision: AgentDecisionView }) {
  const { t } = useTranslation();
  const decide = useDecideProposal();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const message = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t('automation.case.error'));
  const shown = error ?? decision.executionError;

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={decide.isPending} onClick={() => (setError(null), decide.mutate({ id: decision.id, approve: true }, { onError: (e) => setError(message(e)) }))}>
          {decide.isPending && decide.variables?.approve ? t('common.loading') : t('automation.case.approve')}
        </Button>
        <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => (setError(null), setDeclining(true))}>
          {t('automation.case.decline')}
        </Button>
      </div>
      {shown && !declining && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t('automation.case.failed', { error: shown })}
        </p>
      )}
      {declining && (
        <ConfirmDialog
          title={t('automation.case.declineTitle')}
          message={t('automation.case.declineMessage')}
          confirmLabel={t('automation.case.decline')}
          tone="danger"
          pending={decide.isPending}
          error={error}
          onConfirm={() =>
            decide.mutate({ id: decision.id, approve: false, reason: reason.trim() || undefined }, { onSuccess: () => (setDeclining(false), setReason('')), onError: (e) => setError(message(e)) })
          }
          onCancel={() => (setDeclining(false), setError(null))}
        >
          <div className="mb-4">
            <Label htmlFor={`decline-${decision.id}`}>{t('automation.case.reason')}</Label>
            <Input id={`decline-${decision.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** A link to what carrying the step out produced, when there is something to open. */
export function DecisionResult({ decision }: { decision: AgentDecisionView }) {
  const { t } = useTranslation();
  const r = decision.result;
  if (r && typeof r.payoutId === 'string') {
    return (
      <Link href={`/payouts/${r.payoutId}`} className="text-xs font-medium text-brand-dark hover:underline">
        {t('automation.case.openPayout', { reference: String(r.reference ?? '') })}
      </Link>
    );
  }
  if (!r || typeof r.invoiceId !== 'string') return null;
  return (
    <Link href={`/invoices/${r.invoiceId}`} className="text-xs font-medium text-brand-dark hover:underline">
      {t('automation.case.openInvoice', { number: String(r.number ?? '') })}
    </Link>
  );
}
