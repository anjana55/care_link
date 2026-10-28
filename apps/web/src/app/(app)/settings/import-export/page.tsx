'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useInitialParam } from '@/lib/use-initial-param';
import { TransferPanel } from '@/components/data-transfer/transfer-panel';
import type { TransferKind } from '@/lib/hooks/use-data-transfer';
import { cn } from '@/lib/utils';

const KINDS = ['caregivers', 'clients'] as const;

/**
 * Settings > Import & export (admins only): spreadsheet export of caregivers and clients (with the list
 * filters), and bulk import from a filled-in template. `?type=clients` opens
 * on clients - the lists link here that way.
 */
export default function DataTransferPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<TransferKind>('caregivers');
  useInitialParam('type', KINDS, setKind);

  useEffect(() => {
    if (!loading && user && user.role !== 'ADMIN') router.replace('/settings');
  }, [loading, user, router]);

  if (loading || user?.role !== 'ADMIN') return <p className="py-10 text-center text-sm text-ink/50">{t('common.loading')}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 text-lg font-semibold text-ink">{t('dataTransfer.title')}</h2>
        <p className="text-sm text-ink/60">{t('dataTransfer.subtitle')}</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors', kind === k ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink')}
          >
            {t(`dataTransfer.tabs.${k}`)}
          </button>
        ))}
      </div>
      {/* Keyed so switching resets the chosen file and report. */}
      <TransferPanel key={kind} kind={kind} />
    </div>
  );
}
