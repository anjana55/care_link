'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent } from '@/components/ui/card';

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs-global'],
    queryFn: () => api.get<AuditEntry[]>('/audit-logs?pageSize=50'),
    enabled: user?.role === 'ADMIN',
  });

  if (user?.role !== 'ADMIN') {
    return <p className="text-sm text-ink/50">Only administrators can view the audit log.</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('nav.auditLog')}</h1>
      <Card>
        <CardContent className="divide-y divide-border py-0">
          {isLoading && <p className="py-5 text-sm text-ink/50">{t('common.loading')}</p>}
          {data?.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-3 text-sm first:pt-5 last:pb-5">
              <div>
                <span className="font-medium text-ink">{entry.action.replace(/_/g, ' ')}</span>
                <span className="ml-2 text-ink/40">
                  {entry.entityType}
                  {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                </span>
              </div>
              <span className="text-ink/40">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {data?.length === 0 && <p className="py-5 text-sm text-ink/40">No audit entries yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
