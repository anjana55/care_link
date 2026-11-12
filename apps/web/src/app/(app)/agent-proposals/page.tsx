'use client';

import Link from 'next/link';
import type { AutomationCaseType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';
import { useAwaitingProposals } from '@/lib/hooks/use-automation';
import { Card, CardContent } from '@/components/ui/card';
import { ProposalActions } from '@/components/automation/proposal-actions';

const CASE_PATHS: Partial<Record<AutomationCaseType, string>> = {
  REQUEST: '/requests',
  BOOKING: '/bookings',
  INVOICE: '/invoices',
  PAYOUT: '/payouts',
  CAREGIVER: '/caregivers',
};

/**
 * Everything the agents are waiting on a person for, in one list (reached
 * from the dashboard's Needs attention). The same Approve / Decline as on
 * each record's own page.
 */
export default function AgentProposalsPage() {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useAwaitingProposals();

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-xl font-semibold text-ink">{t('automation.proposals.title')}</h1>
      <p className="mb-4 text-sm text-ink/60">{t('automation.proposals.subtitle')}</p>
      {isLoading ? (
        <p className="text-sm text-ink/50">{t('common.loading')}</p>
      ) : !data?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink/60">{t('automation.proposals.none')}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {data.map((d) => {
            const path = d.caseType && d.caseId ? CASE_PATHS[d.caseType] : undefined;
            const reference = [d.proposal?.bookingReference, d.proposal?.payoutReference, d.proposal?.requestReference].find((r): r is string => typeof r === 'string') ?? null;
            // A proposed pay statement does not exist yet: point at the caregiver it is for.
            // A proposed job offer names its caregiver too, next to the request.
            const caregiver =
              (!path || d.action === 'matching.send_offer') && typeof d.proposal?.caregiverId === 'string'
                ? { id: d.proposal.caregiverId, reference: String(d.proposal.caregiverRegistration ?? '') }
                : null;
            return (
              <li key={d.id}>
                <Card>
                  <CardContent className="space-y-1 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{d.actionLabel}</p>
                      <p className="text-xs tabular-nums text-ink/50">{fmtDateTime(d.createdAt, locale)}</p>
                    </div>
                    <p className="text-sm text-ink/70">{d.reason}</p>
                    {path && (
                      <Link href={`${path}/${d.caseId}`} className="block text-sm font-medium text-brand-dark hover:underline">
                        {t(`automation.caseTypes.${d.caseType}`)}
                        {reference ? ` ${reference}` : ''} · {t('automation.proposals.open')}
                      </Link>
                    )}
                    {caregiver && (
                      <Link href={`/caregivers/${caregiver.id}`} className="block text-sm font-medium text-brand-dark hover:underline">
                        {t('automation.proposals.caregiver', { reference: caregiver.reference })} · {t('automation.proposals.open')}
                      </Link>
                    )}
                    <ProposalActions decision={d} />
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
