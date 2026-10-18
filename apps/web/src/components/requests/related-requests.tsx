'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useCareRequests } from '@/lib/hooks/use-care-requests';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RequestStatusBadge } from './request-status-badge';

/**
 * The requests that involve one client or one caregiver, for the bottom of
 * their record. Shows the other party, so staff can see at a glance who this
 * person has been matched with before.
 */
export function RelatedRequests({ patientId, caregiverId }: { patientId?: string; caregiverId?: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useCareRequests({ patientId, caregiverId, pageSize: 10 });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{t('requests.related.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {data && data.items.length === 0 && <p className="text-sm text-ink/50">{t('requests.related.empty')}</p>}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {data.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link href={`/requests/${r.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {r.reference}
                  </Link>
                  <span className="ml-2 text-sm text-ink/60">
                    {patientId ? `${r.caregiverName} (${r.caregiverRegistrationNumber})` : r.clientName}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink/50">{new Date(r.createdAt).toLocaleDateString()}</span>
                  <RequestStatusBadge status={r.status} label={t(`requests.status.${r.status}`)} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > data.items.length && (
          <p className="mt-2 text-xs text-ink/50">{t('requests.related.more', { count: data.total - data.items.length })}</p>
        )}
      </CardContent>
    </Card>
  );
}
